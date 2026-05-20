import pool from "../config/db.js"

// ===== VENDEDOR =====

export const getOrders = async (req, res) => {
    try {
        const orders = await pool.query(
            `SELECT o.*, u.name as user_name, u.email as user_email, u.phone as user_phone,
        json_agg(json_build_object(
          'product_id', oi.product_id,
          'name', p.name,
          'quantity', oi.quantity,
          'price', oi.price,
          'image_url', p.image_url
        )) as items
       FROM orders o
       JOIN users u ON o.user_id = u.id
       JOIN order_items oi ON o.id = oi.order_id
       JOIN products p ON oi.product_id = p.id
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
    const validStatuses = ["pending", "paid", "processing", "shipped", "delivered", "cancelled"]
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
        json_agg(json_build_object(
          'product_id', oi.product_id,
          'name', p.name,
          'quantity', oi.quantity,
          'price', oi.price,
          'image_url', p.image_url
        )) as items
       FROM orders o
       JOIN users u ON o.user_id = u.id
       JOIN order_items oi ON o.id = oi.order_id
       JOIN products p ON oi.product_id = p.id
       WHERE o.status IN ('paid', 'processing', 'shipped')
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