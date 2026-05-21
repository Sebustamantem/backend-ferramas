import { WebpayPlus, Options, IntegrationApiKeys, IntegrationCommerceCodes, Environment } from "transbank-sdk"
import pool from "../config/db.js"
import { releaseExpiredReservations } from "./cartController.js"
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
        await releaseExpiredReservations()
        const backendUrl = process.env.BACKEND_URL

        if (!backendUrl) {
            return res.status(500).json({
                message: "BACKEND_URL no está configurado en Render o en el archivo .env",
            })
        }

        const cartItems = await pool.query(
            `SELECT ci.product_id, ci.quantity, p.price, p.name, p.image_url
             FROM cart_items ci
             JOIN products p ON ci.product_id = p.id
             WHERE ci.user_id = $1`,
            [req.user.id]
        )

        if (cartItems.rows.length === 0) {
            return res.status(400).json({
                message: "El carrito está vacío",
            })
        }

        const total = cartItems.rows.reduce(
            (acc, item) => acc + Number(item.price) * Number(item.quantity),
            0
        )

        const shipping = total >= 50000 ? 0 : 4990
        const finalTotal = Math.round(total + shipping)

        const orderResult = await pool.query(
            `INSERT INTO orders (user_id, total, status, address)
             VALUES ($1, $2, 'pending', $3)
             RETURNING *`,
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
        const returnUrl = `${backendUrl.replace(/\/$/, "")}/api/payment/confirm`

        console.log("BACKEND_URL:", backendUrl)
        console.log("RETURN_URL:", returnUrl)
        console.log("BUY_ORDER:", buyOrder)
        console.log("SESSION_ID:", sessionId)
        console.log("FINAL_TOTAL:", finalTotal)

        const response = await tx.create(
            buyOrder,
            sessionId,
            finalTotal,
            returnUrl
        )

        await pool.query(
            `UPDATE orders
             SET transbank_token = $1
             WHERE id = $2`,
            [response.token, order.id]
        )

        return res.json({
            url: response.url,
            token: response.token,
            order_id: order.id,
        })

    } catch (err) {
        console.error("Transbank error completo:", err)
        console.error("Error message:", err.message)
        console.error("Error response data:", err.response?.data)
        console.error("Error status:", err.response?.status)

        return res.status(500).json({
            message: "Error al crear transacción",
            error: err.message,
            detail: err.response?.data || null,
        })
    }
}

export const createTransferOrder = async (req, res) => {
    const { address } = req.body
    const client = await pool.connect()

    try {
        await releaseExpiredReservations()
        await client.query("BEGIN")

        const cartItems = await client.query(
            `SELECT ci.product_id, ci.quantity, p.price, p.name
             FROM cart_items ci
             JOIN products p ON ci.product_id = p.id
             WHERE ci.user_id = $1`,
            [req.user.id]
        )

        if (cartItems.rows.length === 0) {
            await client.query("ROLLBACK")
            return res.status(400).json({ message: "El carrito esta vacio" })
        }

        const subtotal = cartItems.rows.reduce(
            (acc, item) => acc + Number(item.price) * Number(item.quantity),
            0
        )
        const shipping = subtotal >= 50000 ? 0 : 4990
        const finalTotal = Math.round(subtotal + shipping)

        const orderResult = await client.query(
            `INSERT INTO orders (user_id, total, status, address)
             VALUES ($1, $2, 'transfer_pending', $3)
             RETURNING *`,
            [req.user.id, finalTotal, JSON.stringify(address)]
        )
        const order = orderResult.rows[0]

        for (const item of cartItems.rows) {
            await client.query(
                `INSERT INTO order_items (order_id, product_id, quantity, price)
                 VALUES ($1, $2, $3, $4)`,
                [order.id, item.product_id, item.quantity, item.price]
            )

            const reservation = await client.query(
                `SELECT quantity
                 FROM stock_reservations
                 WHERE user_id = $1 AND product_id = $2`,
                [req.user.id, item.product_id]
            )
            const reservedQuantity = Number(reservation.rows[0]?.quantity || 0)
            const missingQuantity = Math.max(Number(item.quantity) - reservedQuantity, 0)

            if (missingQuantity > 0) {
                await client.query(
                    `UPDATE products
                     SET stock = stock - $1
                     WHERE id = $2`,
                    [missingQuantity, item.product_id]
                )
            }
        }

        await client.query(`DELETE FROM cart_items WHERE user_id = $1`, [req.user.id])
        await client.query(`DELETE FROM stock_reservations WHERE user_id = $1`, [req.user.id])
        await client.query("COMMIT")

        return res.status(201).json({
            order_id: order.id,
            status: order.status,
            total: order.total,
            message: "Pedido creado. El contador debe confirmar la transferencia.",
        })
    } catch (err) {
        await client.query("ROLLBACK")
        console.error("Transfer order error:", err)
        return res.status(500).json({
            message: "Error al crear pedido por transferencia",
            error: err.message,
        })
    } finally {
        client.release()
    }
}

export const confirmTransaction = async (req, res) => {
    const { token_ws } = req.query
    const frontendUrl = process.env.FRONTEND_URL

    if (!frontendUrl) {
        return res.status(500).json({
            message: "FRONTEND_URL no está configurado en Render o en el archivo .env",
        })
    }

    if (!token_ws) {
        return res.redirect(`${frontendUrl.replace(/\/$/, "")}/checkout/failure`)
    }

    try {
        const response = await tx.commit(token_ws)

        console.log("Transbank response:", response)

        const orderResult = await pool.query(
            `SELECT *
             FROM orders
             WHERE transbank_token = $1`,
            [token_ws]
        )

        if (orderResult.rows.length === 0) {
            return res.redirect(`${frontendUrl.replace(/\/$/, "")}/checkout/failure`)
        }

        const order = orderResult.rows[0]
        const orderId = order.id

        if (response.status === "AUTHORIZED") {
            await pool.query(
                `UPDATE orders
                 SET status = 'paid'
                 WHERE id = $1`,
                [orderId]
            )

            const items = await pool.query(
                `SELECT product_id, quantity
                 FROM order_items
                 WHERE order_id = $1`,
                [orderId]
            )

            for (const item of items.rows) {
                const reservation = await pool.query(
                    `SELECT quantity
                     FROM stock_reservations
                     WHERE user_id = $1 AND product_id = $2`,
                    [order.user_id, item.product_id]
                )
                const reservedQuantity = Number(reservation.rows[0]?.quantity || 0)
                const missingQuantity = Math.max(Number(item.quantity) - reservedQuantity, 0)
                if (missingQuantity > 0) {
                    await pool.query(
                        `UPDATE products
                         SET stock = stock - $1
                         WHERE id = $2`,
                        [missingQuantity, item.product_id]
                    )
                }
            }

            await pool.query(`DELETE FROM cart_items WHERE user_id = $1`, [order.user_id])
            await pool.query(`DELETE FROM stock_reservations WHERE user_id = $1`, [order.user_id])

            return res.redirect(
                `${frontendUrl.replace(/\/$/, "")}/checkout/success?order_id=${orderId}`
            )
        }

        const reservations = await pool.query(
            `SELECT product_id, quantity
             FROM stock_reservations
             WHERE user_id = $1`,
            [order.user_id]
        )

        for (const reservation of reservations.rows) {
            await pool.query(
                `UPDATE products
                 SET stock = stock + $1
                 WHERE id = $2`,
                [reservation.quantity, reservation.product_id]
            )
        }

        await pool.query(
            `DELETE FROM stock_reservations
             WHERE user_id = $1`,
            [order.user_id]
        )

        await pool.query(
            `DELETE FROM cart_items
             WHERE user_id = $1`,
            [order.user_id]
        )

        await pool.query(
            `UPDATE orders
             SET status = 'cancelled'
             WHERE id = $1`,
            [orderId]
        )

        return res.redirect(`${frontendUrl.replace(/\/$/, "")}/checkout/failure`)

    } catch (err) {
        console.error("Confirm error completo:", err)
        console.error("Error message:", err.message)
        console.error("Error response data:", err.response?.data)
        console.error("Error status:", err.response?.status)

        return res.redirect(`${frontendUrl.replace(/\/$/, "")}/checkout/failure`)
    }
}
