import { MercadoPagoConfig, Preference } from "mercadopago"
import pool from "../config/db.js"
import "dotenv/config"

const client = new MercadoPagoConfig({
    accessToken: process.env.MP_ACCESS_TOKEN,
})

export const createPreference = async (req, res) => {
    const { address } = req.body
    try {
        // Obtener carrito del usuario
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

        // Crear orden en BD
        const orderResult = await pool.query(
            `INSERT INTO orders (user_id, total, status, address)
       VALUES ($1, $2, 'pending', $3) RETURNING *`,
            [req.user.id, total, JSON.stringify(address)]
        )
        const order = orderResult.rows[0]

        // Guardar items de la orden
        for (const item of cartItems.rows) {
            await pool.query(
                `INSERT INTO order_items (order_id, product_id, quantity, price)
         VALUES ($1, $2, $3, $4)`,
                [order.id, item.product_id, item.quantity, item.price]
            )
        }

        // Crear preferencia en Mercado Pago
        const preference = new Preference(client)
        const response = await preference.create({
            body: {
                items: cartItems.rows.map((item) => ({
                    id: String(item.product_id),
                    title: item.name,
                    quantity: item.quantity,
                    unit_price: Number(item.price),
                    currency_id: "CLP",
                    picture_url: item.image_url || "",
                })),
                back_urls: {
                    success: `${process.env.FRONTEND_URL}/checkout/success?order_id=${order.id}`,
                    failure: `${process.env.FRONTEND_URL}/checkout/failure?order_id=${order.id}`,
                    pending: `${process.env.FRONTEND_URL}/checkout/pending?order_id=${order.id}`,
                },
                auto_return: "approved",
                external_reference: String(order.id),
                notification_url: `${process.env.BACKEND_URL}/api/payment/webhook`,
            },
        })

        res.json({
            init_point: response.init_point,
            sandbox_init_point: response.sandbox_init_point,
            order_id: order.id,
            preference_id: response.id,
        })
    } catch (err) {
        console.error(err)
        res.status(500).json({ message: "Error al crear preferencia", error: err.message })
    }
}

export const webhook = async (req, res) => {
    const { type, data } = req.body
    try {
        if (type === "payment") {
            const { MercadoPagoConfig: MPConfig, Payment } = await import("mercadopago")
            const mpClient = new MPConfig({ accessToken: process.env.MP_ACCESS_TOKEN })
            const payment = new Payment(mpClient)
            const paymentData = await payment.get({ id: data.id })

            const orderId = paymentData.external_reference
            const status = paymentData.status

            if (status === "approved") {
                await pool.query(
                    "UPDATE orders SET status = 'paid', transbank_token = $1 WHERE id = $2",
                    [String(data.id), orderId]
                )

                // Vaciar carrito
                const order = await pool.query("SELECT user_id FROM orders WHERE id = $1", [orderId])
                if (order.rows.length > 0) {
                    await pool.query("DELETE FROM cart_items WHERE user_id = $1", [order.rows[0].user_id])
                    await pool.query("DELETE FROM stock_reservations WHERE user_id = $1", [order.rows[0].user_id])
                }
            } else if (status === "rejected" || status === "cancelled") {
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
            }
        }
        res.sendStatus(200)
    } catch (err) {
        console.error("Webhook error:", err)
        res.sendStatus(500)
    }
}