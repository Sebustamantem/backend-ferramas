import { WebpayPlus, Options, IntegrationApiKeys, IntegrationCommerceCodes, Environment } from "transbank-sdk"
import pool from "../config/db.js"
import "dotenv/config"

const tx = new WebpayPlus.Transaction(
    new Options(
        IntegrationCommerceCodes.WEBPAY_PLUS,
        IntegrationApiKeys.WEBPAY,
        Environment.Integration
    )
)

export const createTransaction = async (req, res) => {
    const { address } = req.body
    try {
        const cartItems = await pool.query(
            `SELECT ci.product_id, ci.quantity, p.price, p.name, p.image_url
       FROM cart_items ci
       JOIN products p ON ci.product_id = p.id
       WHERE ci.user_id = $1`,
            [req.user.id]
        )

        if (cartItems.rows.length === 0)
            return res.status(400).json({ message: "El carrito está vacío" })

        const total = cartItems.rows.reduce(
            (acc, item) => acc + Number(item.price) * item.quantity, 0
        )

        const shipping = total >= 50000 ? 0 : 4990
        const finalTotal = total + shipping

        // Crear orden en BD
        const orderResult = await pool.query(
            `INSERT INTO orders (user_id, total, status, address)
       VALUES ($1, $2, 'pending', $3) RETURNING *`,
            [req.user.id, finalTotal, JSON.stringify(address)]
        )
        const order = orderResult.rows[0]

        for (const item of cartItems.rows) {
            await pool.query(
                `INSERT INTO order_items (order_id, product_id, quantity, price)
         VALUES ($1, $2, $3, $4)`,
                [order.id, item.product_id, item.quantity, item.price]
            )
        }

        const buyOrder = `ORDER-${order.id}-${Date.now()}`
        const sessionId = `SESSION-${req.user.id}-${Date.now()}`
        const returnUrl = `${process.env.BACKEND_URL}/api/payment/confirm`

        const response = await tx.create(buyOrder, sessionId, finalTotal, returnUrl)

        // Guardar token de transbank en la orden
        await pool.query(
            "UPDATE orders SET transbank_token = $1 WHERE id = $2",
            [response.token, order.id]
        )

        res.json({
            url: response.url,
            token: response.token,
            order_id: order.id
        })
    } catch (err) {
        console.error("Transbank error:", err)
        res.status(500).json({ message: "Error al crear transacción", error: err.message })
    }
}

export const confirmTransaction = async (req, res) => {
    const { token_ws } = req.query

    if (!token_ws) {
        return res.redirect(`${process.env.FRONTEND_URL}/checkout/failure`)
    }

    try {
        const response = await tx.commit(token_ws)
        console.log("Transbank response:", response)

        const order = await pool.query(
            "SELECT * FROM orders WHERE transbank_token = $1",
            [token_ws]
        )

        if (order.rows.length === 0)
            return res.redirect(`${process.env.FRONTEND_URL}/checkout/failure`)

        const orderId = order.rows[0].id

        if (response.status === "AUTHORIZED") {
            await pool.query(
                "UPDATE orders SET status = 'paid' WHERE id = $1",
                [orderId]
            )

            // Vaciar carrito
            const userId = order.rows[0].user_id
            await pool.query("DELETE FROM cart_items WHERE user_id = $1", [userId])
            await pool.query("DELETE FROM stock_reservations WHERE user_id = $1", [userId])

            // Descontar stock definitivamente
            const items = await pool.query(
                "SELECT product_id, quantity FROM order_items WHERE order_id = $1",
                [orderId]
            )
            for (const item of items.rows) {
                await pool.query(
                    "UPDATE products SET stock = stock - $1 WHERE id = $2",
                    [item.quantity, item.product_id]
                )
            }

            return res.redirect(`${process.env.FRONTEND_URL}/checkout/success?order_id=${orderId}`)
        } else {
            await pool.query(
                "UPDATE orders SET status = 'cancelled' WHERE id = $1",
                [orderId]
            )

            // Devolver stock
            const items = await pool.query(
                "SELECT product_id, quantity FROM order_items WHERE order_id = $1",
                [orderId]
            )
            for (const item of items.rows) {
                await pool.query(
                    "UPDATE products SET stock = stock + $1 WHERE id = $2",
                    [item.quantity, item.product_id]
                )
            }

            return res.redirect(`${process.env.FRONTEND_URL}/checkout/failure`)
        }
    } catch (err) {
        console.error("Confirm error:", err)
        return res.redirect(`${process.env.FRONTEND_URL}/checkout/failure`)
    }
}