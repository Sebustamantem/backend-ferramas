import pool from "../config/db.js"
import { addPointsForOrder, restoreUsedPointsForOrder } from "./pointsController.js"
import { cancelServiceRequestsForOrder, markServiceRequestsPaid } from "./serviceController.js"

// ===== VENDEDOR =====

export const getOrders = async (req, res) => {
    try {
        const orders = await pool.query(
            `SELECT o.*, u.name as user_name, u.email as user_email, u.phone as user_phone,
        COALESCE(json_agg(json_build_object(
          'product_id', oi.product_id,
          'name', p.name,
          'quantity', oi.quantity,
          'price', oi.price,
          'image_url', p.image_url
        )) FILTER (WHERE oi.id IS NOT NULL), '[]') as items
       FROM orders o
       JOIN users u ON o.user_id = u.id
       LEFT JOIN order_items oi ON o.id = oi.order_id
       LEFT JOIN products p ON oi.product_id = p.id
       GROUP BY o.id, u.name, u.email, u.phone
       ORDER BY o.created_at DESC`
        )
        res.json(orders.rows)
    } catch (err) {
        res.status(500).json({ message: "Error al obtener pedidos", error: err.message })
    }
}

export const updateOrderStatus = async (req, res) => {
    const { id } = req.params
    const { status } = req.body
    const validStatuses = ["pending", "transfer_pending", "paid", "processing", "shipped", "delivered", "cancelled"]
    if (!validStatuses.includes(status))
        return res.status(400).json({ message: "Estado inválido" })
    try {
        const result = await pool.query(
            "UPDATE orders SET status=$1 WHERE id=$2 RETURNING *",
            [status, id]
        )
        if (result.rows.length === 0)
            return res.status(404).json({ message: "Orden no encontrada" })
        res.json(result.rows[0])
    } catch (err) {
        res.status(500).json({ message: "Error al actualizar estado", error: err.message })
    }
}

export const getClients = async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT id, name, lastname, email, rut, phone, user_type, created_at
       FROM users
       WHERE role = 'cliente'
       ORDER BY created_at DESC`
        )
        res.json(result.rows)
    } catch (err) {
        res.status(500).json({ message: "Error al obtener clientes", error: err.message })
    }
}

// ===== BODEGUERO =====

export const getInventory = async (req, res) => {
    try {
        const result = await pool.query(
            "SELECT * FROM products ORDER BY stock ASC"
        )
        res.json(result.rows)
    } catch (err) {
        res.status(500).json({ message: "Error al obtener inventario", error: err.message })
    }
}

export const updateStock = async (req, res) => {
    const { id } = req.params
    const { stock, reason } = req.body
    try {
        const result = await pool.query(
            "UPDATE products SET stock=$1 WHERE id=$2 RETURNING *",
            [stock, id]
        )
        if (result.rows.length === 0)
            return res.status(404).json({ message: "Producto no encontrado" })
        res.json(result.rows[0])
    } catch (err) {
        res.status(500).json({ message: "Error al actualizar stock", error: err.message })
    }
}

export const getOrdersForWarehouse = async (req, res) => {
    try {
        const orders = await pool.query(
            `SELECT o.*, u.name as user_name, u.email as user_email,
        COALESCE(json_agg(json_build_object(
          'product_id', oi.product_id,
          'name', p.name,
          'quantity', oi.quantity,
          'price', oi.price,
          'image_url', p.image_url
        )) FILTER (WHERE oi.id IS NOT NULL), '[]') as items
       FROM orders o
       JOIN users u ON o.user_id = u.id
       LEFT JOIN order_items oi ON o.id = oi.order_id
       LEFT JOIN products p ON oi.product_id = p.id
       WHERE o.status IN ('paid', 'processing', 'shipped', 'delivered')
       GROUP BY o.id, u.name, u.email
       ORDER BY o.created_at DESC`
        )
        res.json(orders.rows)
    } catch (err) {
        res.status(500).json({ message: "Error al obtener pedidos", error: err.message })
    }
}

export const dispatchOrder = async (req, res) => {
    const { id } = req.params
    try {
        const result = await pool.query(
            "UPDATE orders SET status='shipped' WHERE id=$1 AND status='processing' RETURNING *",
            [id]
        )
        if (result.rows.length === 0)
            return res.status(400).json({ message: "El pedido no está en estado processing" })
        res.json(result.rows[0])
    } catch (err) {
        res.status(500).json({ message: "Error al despachar pedido", error: err.message })
    }
}

export const updateWarehouseOrderStatus = async (req, res) => {
    const { id } = req.params
    const { status } = req.body
    const validStatuses = ["processing", "shipped", "delivered"]
    if (!validStatuses.includes(status))
        return res.status(400).json({ message: "Estado invalido para bodega" })

    try {
        const result = await pool.query(
            `UPDATE orders
             SET status=$1
             WHERE id=$2
               AND (
                (status='paid' AND $1='processing')
                OR (status='processing' AND $1='shipped')
                OR (status='shipped' AND $1='delivered')
               )
             RETURNING *`,
            [status, id]
        )
        if (result.rows.length === 0)
            return res.status(400).json({ message: "No se puede aplicar ese cambio de estado" })
        res.json(result.rows[0])
    } catch (err) {
        res.status(500).json({ message: "Error al actualizar estado del pedido", error: err.message })
    }
}

// ===== CONTADOR =====

export const getAccountingOrders = async (req, res) => {
    try {
        const orders = await pool.query(
            `SELECT o.*, u.name as user_name, u.email as user_email, u.phone as user_phone,
        COALESCE(json_agg(json_build_object(
          'product_id', oi.product_id,
          'name', p.name,
          'quantity', oi.quantity,
          'price', oi.price,
          'image_url', p.image_url
        )) FILTER (WHERE oi.id IS NOT NULL), '[]') as items
       FROM orders o
       JOIN users u ON o.user_id = u.id
       LEFT JOIN order_items oi ON o.id = oi.order_id
       LEFT JOIN products p ON oi.product_id = p.id
       WHERE o.status IN ('transfer_pending', 'paid', 'processing', 'shipped', 'delivered', 'cancelled')
       GROUP BY o.id, u.name, u.email, u.phone
       ORDER BY o.created_at DESC`
        )
        res.json(orders.rows)
    } catch (err) {
        res.status(500).json({ message: "Error al obtener pedidos contables", error: err.message })
    }
}

export const confirmTransferOrder = async (req, res) => {
    const { id } = req.params
    try {
        const result = await pool.query(
            `UPDATE orders
             SET status='paid'
             WHERE id=$1 AND status='transfer_pending'
             RETURNING *`,
            [id]
        )
        if (result.rows.length === 0)
            return res.status(400).json({ message: "El pedido no tiene transferencia pendiente" })
        await markServiceRequestsPaid(pool, result.rows[0].id)
        const productTotal = await pool.query(
            "SELECT COALESCE(SUM(quantity * price), 0) as total FROM order_items WHERE order_id=$1",
            [result.rows[0].id]
        )
        await addPointsForOrder(pool, result.rows[0].user_id, result.rows[0].id, productTotal.rows[0].total)
        res.json(result.rows[0])
    } catch (err) {
        res.status(500).json({ message: "Error al confirmar transferencia", error: err.message })
    }
}

export const rejectTransferOrder = async (req, res) => {
    const { id } = req.params
    const client = await pool.connect()

    try {
        await client.query("BEGIN")
        const order = await client.query(
            "SELECT * FROM orders WHERE id=$1 AND status='transfer_pending'",
            [id]
        )

        if (order.rows.length === 0) {
            await client.query("ROLLBACK")
            return res.status(400).json({ message: "El pedido no tiene transferencia pendiente" })
        }

        const items = await client.query(
            "SELECT product_id, quantity FROM order_items WHERE order_id=$1",
            [id]
        )

        for (const item of items.rows) {
            await client.query(
                "UPDATE products SET stock = stock + $1 WHERE id=$2",
                [item.quantity, item.product_id]
            )
        }

        const result = await client.query(
            "UPDATE orders SET status='cancelled' WHERE id=$1 RETURNING *",
            [id]
        )
        await cancelServiceRequestsForOrder(client, id)
        await restoreUsedPointsForOrder(
            client,
            order.rows[0].user_id,
            id,
            "Devolucion por transferencia rechazada"
        )
        await client.query("COMMIT")
        res.json(result.rows[0])
    } catch (err) {
        await client.query("ROLLBACK")
        res.status(500).json({ message: "Error al rechazar transferencia", error: err.message })
    } finally {
        client.release()
    }
}

export const registerDeliveredOrder = async (req, res) => {
    const { id } = req.params
    try {
        const result = await pool.query(
            `UPDATE orders
             SET status='delivered'
             WHERE id=$1 AND status='shipped'
             RETURNING *`,
            [id]
        )
        if (result.rows.length === 0)
            return res.status(400).json({ message: "Solo se puede entregar un pedido despachado" })
        res.json(result.rows[0])
    } catch (err) {
        res.status(500).json({ message: "Error al registrar entrega", error: err.message })
    }
}
