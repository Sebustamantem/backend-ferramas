import pool from "../config/db.js"
import { restoreUsedPointsForOrder } from "../controllers/pointsController.js"
import { cancelServiceRequestsForOrder, ensureServiceTables } from "../controllers/serviceController.js"
import { logActivity } from "./activityLog.js"

const getPendingOrderCancelMinutes = () => {
    const minutes = Number(process.env.PENDING_ORDER_CANCEL_MINUTES || 30)
    return Number.isFinite(minutes) && minutes > 0 ? minutes : 30
}

export const cancelExpiredPendingOrders = async ({ force = false } = {}) => {
    const minutes = getPendingOrderCancelMinutes()
    const client = await pool.connect()
    let cancelled = 0

    try {
        await ensureServiceTables()
        await client.query("BEGIN")

        const orders = await client.query(
            `SELECT *
             FROM orders
             WHERE status='pending'
               AND transbank_token IS NOT NULL
               AND ($2::boolean = TRUE OR created_at < NOW() - ($1::text || ' minutes')::interval)
             FOR UPDATE`,
            [minutes, force]
        )

        for (const order of orders.rows) {
            const reservations = await client.query(
                `SELECT sr.product_id, sr.quantity
                 FROM stock_reservations sr
                 JOIN order_items oi ON oi.product_id = sr.product_id
                 WHERE sr.user_id=$1 AND oi.order_id=$2`,
                [order.user_id, order.id]
            )

            for (const reservation of reservations.rows) {
                await client.query(
                    "UPDATE products SET stock = stock + $1 WHERE id=$2",
                    [reservation.quantity, reservation.product_id]
                )
            }

            await client.query("DELETE FROM stock_reservations WHERE user_id=$1", [order.user_id])
            await client.query("DELETE FROM cart_items WHERE user_id=$1", [order.user_id])
            await cancelServiceRequestsForOrder(client, order.id, false)
            await restoreUsedPointsForOrder(client, order.user_id, order.id, "Devolucion por pedido no pagado")
            await client.query(
                "UPDATE orders SET status='cancelled' WHERE id=$1",
                [order.id]
            )
            cancelled += 1
        }

        await client.query("COMMIT")

        if (cancelled > 0) {
            await logActivity({
                action: "pending_orders_auto_cancelled",
                entityType: "order",
                description: `Sistema cancelo ${cancelled} pedidos pendientes por no pago`,
                metadata: { cancelled, minutes, force },
            }).catch((logErr) => console.error("Error registrando actividad:", logErr.message))
        }

        return { cancelled, minutes }
    } catch (err) {
        await client.query("ROLLBACK")
        throw err
    } finally {
        client.release()
    }
}
