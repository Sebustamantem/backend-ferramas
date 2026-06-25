import { WebpayPlus, Options, IntegrationApiKeys, IntegrationCommerceCodes, Environment } from "transbank-sdk"
import pool from "../config/db.js"
import { releaseExpiredReservations } from "./cartController.js"
import { addPointsForOrder, ensurePointsTables, restoreUsedPointsForOrder, usePointsForOrder } from "./pointsController.js"
import {
    cancelServiceRequestsForOrder,
    clearServiceCart,
    createServiceRequestsForOrder,
    ensureServiceTables,
    markServiceRequestsPaid,
} from "./serviceController.js"
import { sendOrderConfirmationEmail } from "../utils/email.js"
import "dotenv/config"

const tx = new WebpayPlus.Transaction(
    new Options(
        IntegrationCommerceCodes.WEBPAY_PLUS,
        IntegrationApiKeys.WEBPAY,
        Environment.Integration
    )
)

const buildFrontendRoute = (frontendUrl, path) => `${frontendUrl.replace(/\/$/, "")}${path}`

const getDisplayName = (user = {}) => [user.name, user.lastname].filter(Boolean).join(" ").trim() || user.email

export const createTransaction = async (req, res) => {
    const { address, points_to_use = 0, delivery_method = "delivery" } = req.body
    let createdOrderId = null
    let deductedPoints = 0

    try {
        await releaseExpiredReservations()
        await ensurePointsTables()
        await ensureServiceTables()
        const deliveryMethod = delivery_method === "pickup" ? "pickup" : "delivery"
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

        const serviceCart = await pool.query(
            "SELECT COUNT(*)::int as count FROM service_cart_items WHERE user_id=$1",
            [req.user.id]
        )
        const serviceTotal = Number(serviceCart.rows[0]?.count || 0) * 5000

        if (cartItems.rows.length === 0 && serviceTotal === 0) {
            return res.status(400).json({
                message: "El carrito está vacío",
            })
        }

        const productTotal = cartItems.rows.reduce(
            (acc, item) => acc + Number(item.price) * Number(item.quantity),
            0
        )
        const total = productTotal + serviceTotal

        const shipping = deliveryMethod === "delivery" && productTotal > 0 && productTotal < 50000 ? 4990 : 0
        const beforePointsTotal = Math.round(total + shipping)

        const orderResult = await pool.query(
            `INSERT INTO orders (user_id, total, status, address, delivery_method)
             VALUES ($1, $2, 'pending', $3, $4)
             RETURNING *`,
            [req.user.id, beforePointsTotal, JSON.stringify(address), deliveryMethod]
        )

        const order = orderResult.rows[0]
        createdOrderId = order.id
        deductedPoints = await usePointsForOrder(pool, req.user.id, order.id, points_to_use, beforePointsTotal)
        const finalTotal = Math.max(beforePointsTotal - deductedPoints, 0)
        if (deductedPoints > 0) {
            await pool.query("UPDATE orders SET total=$1 WHERE id=$2", [finalTotal, order.id])
        }

        for (const item of cartItems.rows) {
            await pool.query(
                `INSERT INTO order_items (order_id, product_id, quantity, price)
                 VALUES ($1, $2, $3, $4)`,
                [order.id, item.product_id, item.quantity, item.price]
            )
        }
        await createServiceRequestsForOrder(pool, req.user.id, order.id, "pending_payment")

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
            message: "Transacción Webpay creada correctamente",
            url: response.url,
            token: response.token,
            order_id: order.id,
        })

    } catch (err) {
        console.error("Transbank error completo:", err)
        console.error("Error message:", err.message)
        console.error("Error response data:", err.response?.data)
        console.error("Error status:", err.response?.status)

        if (createdOrderId && deductedPoints > 0) {
            await pool.query(
                `INSERT INTO user_points (user_id, balance)
                 VALUES ($1, $2)
                 ON CONFLICT (user_id)
                 DO UPDATE SET balance = user_points.balance + $2, updated_at = NOW()`,
                [req.user.id, deductedPoints]
            )
            await pool.query(
                `INSERT INTO point_transactions (user_id, order_id, type, points, description)
                 VALUES ($1, $2, 'refunded', $3, 'Devolucion por error al crear pago')`,
                [req.user.id, createdOrderId, deductedPoints]
            )
        }
        if (createdOrderId) {
            await cancelServiceRequestsForOrder(pool, createdOrderId)
        }

        return res.status(500).json({
            message: "Error al crear transacción",
            error: err.message,
            detail: err.response?.data || null,
        })
    }
}

export const createTransferOrder = async (req, res) => {
    const { address, points_to_use = 0, delivery_method = "delivery" } = req.body
    const client = await pool.connect()

    try {
        await releaseExpiredReservations()
        await ensurePointsTables()
        await ensureServiceTables()
        await client.query("BEGIN")
        const deliveryMethod = delivery_method === "pickup" ? "pickup" : "delivery"

        const cartItems = await client.query(
            `SELECT ci.product_id, ci.quantity, p.price, p.name
             FROM cart_items ci
             JOIN products p ON ci.product_id = p.id
             WHERE ci.user_id = $1`,
            [req.user.id]
        )

        const serviceCart = await client.query("SELECT COUNT(*)::int as count FROM service_cart_items WHERE user_id=$1", [req.user.id])
        const serviceTotal = Number(serviceCart.rows[0]?.count || 0) * 5000

        if (cartItems.rows.length === 0 && serviceTotal === 0) {
            await client.query("ROLLBACK")
            return res.status(400).json({ message: "El carrito esta vacio" })
        }

        const productSubtotal = cartItems.rows.reduce(
            (acc, item) => acc + Number(item.price) * Number(item.quantity),
            0
        )
        const subtotal = productSubtotal + serviceTotal
        const shipping = deliveryMethod === "delivery" && productSubtotal > 0 && productSubtotal < 50000 ? 4990 : 0
        const beforePointsTotal = Math.round(subtotal + shipping)

        const orderResult = await client.query(
            `INSERT INTO orders (user_id, total, status, address, delivery_method)
             VALUES ($1, $2, 'transfer_pending', $3, $4)
             RETURNING *`,
            [req.user.id, beforePointsTotal, JSON.stringify(address), deliveryMethod]
        )
        const order = orderResult.rows[0]
        const pointsUsed = await usePointsForOrder(client, req.user.id, order.id, points_to_use, beforePointsTotal)
        const finalTotal = Math.max(beforePointsTotal - pointsUsed, 0)
        if (pointsUsed > 0) {
            await client.query("UPDATE orders SET total=$1 WHERE id=$2", [finalTotal, order.id])
        }

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
        await createServiceRequestsForOrder(client, req.user.id, order.id, "pending_payment", false)

        await client.query(`DELETE FROM cart_items WHERE user_id = $1`, [req.user.id])
        await client.query(`DELETE FROM stock_reservations WHERE user_id = $1`, [req.user.id])
        await clearServiceCart(client, req.user.id, false)
        const userResult = await client.query(
            "SELECT name, lastname, email FROM users WHERE id=$1",
            [req.user.id]
        )
        await client.query("COMMIT")

        sendOrderConfirmationEmail({
            to: userResult.rows[0]?.email,
            name: getDisplayName(userResult.rows[0]),
            order: { ...order, total: finalTotal },
            items: cartItems.rows,
            paymentMethod: "Transferencia bancaria",
        }).catch((emailErr) => console.error("Error enviando confirmacion transferencia:", emailErr.message))

        return res.status(201).json({
            order_id: order.id,
            status: order.status,
            total: finalTotal,
            points_used: pointsUsed,
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
        return res.redirect(buildFrontendRoute(frontendUrl, "/checkout/failure"))
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
            return res.redirect(buildFrontendRoute(frontendUrl, "/checkout/failure"))
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
                `SELECT oi.product_id, oi.quantity, oi.price, p.name
                 FROM order_items oi
                 LEFT JOIN products p ON p.id = oi.product_id
                 WHERE oi.order_id = $1`,
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
            await clearServiceCart(pool, order.user_id)
            await markServiceRequestsPaid(pool, orderId)
            const productPointsTotal = items.rows.reduce(
                (acc, item) => acc + Number(item.price || 0) * Number(item.quantity || 0),
                0
            )
            await addPointsForOrder(pool, order.user_id, orderId, productPointsTotal)

            const userResult = await pool.query(
                "SELECT name, lastname, email FROM users WHERE id=$1",
                [order.user_id]
            )
            sendOrderConfirmationEmail({
                to: userResult.rows[0]?.email,
                name: getDisplayName(userResult.rows[0]),
                order: { ...order, status: "paid" },
                items: items.rows,
                paymentMethod: "Webpay",
            }).catch((emailErr) => console.error("Error enviando confirmacion Webpay:", emailErr.message))

            return res.redirect(buildFrontendRoute(frontendUrl, `/checkout/success?order_id=${orderId}`))
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
        await cancelServiceRequestsForOrder(pool, orderId)

        await restoreUsedPointsForOrder(pool, order.user_id, orderId, "Devolucion por pago rechazado")

        return res.redirect(buildFrontendRoute(frontendUrl, "/checkout/failure"))

    } catch (err) {
        console.error("Confirm error completo:", err)
        console.error("Error message:", err.message)
        console.error("Error response data:", err.response?.data)
        console.error("Error status:", err.response?.status)

        return res.redirect(buildFrontendRoute(frontendUrl, "/checkout/failure"))
    }
}
