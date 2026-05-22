import pool from "../config/db.js"

export const createOrder = async (req, res) => {
    const { address } = req.body
    const client = await pool.connect()
    try {
        await client.query("BEGIN")

        const cartItems = await client.query(
            `SELECT ci.product_id, ci.quantity, p.price, p.name, p.stock
       FROM cart_items ci
       JOIN products p ON ci.product_id = p.id
       WHERE ci.user_id = $1`,
            [req.user.id]
        )

        if (cartItems.rows.length === 0) {
            await client.query("ROLLBACK")
            return res.status(400).json({ message: "El carrito está vacío" })
        }

        const total = cartItems.rows.reduce(
            (acc, item) => acc + Number(item.price) * item.quantity, 0
        )

        const orderResult = await client.query(
            `INSERT INTO orders (user_id, total, status, address)
       VALUES ($1, $2, 'pending', $3) RETURNING *`,
            [req.user.id, total, JSON.stringify(address)]
        )
        const order = orderResult.rows[0]

        for (const item of cartItems.rows) {
            await client.query(
                `INSERT INTO order_items (order_id, product_id, quantity, price)
         VALUES ($1, $2, $3, $4)`,
                [order.id, item.product_id, item.quantity, item.price]
            )
        }

        await client.query("COMMIT")
        res.status(201).json(order)
    } catch (err) {
        await client.query("ROLLBACK")
        res.status(500).json({ message: "Error al crear orden", error: err.message })
    } finally {
        client.release()
    }
}

export const getMyOrders = async (req, res) => {
    try {
        const orders = await pool.query(
            `SELECT o.*,
        COALESCE(json_agg(json_build_object(
          'product_id', oi.product_id,
          'name', p.name,
          'quantity', oi.quantity,
          'price', oi.price,
          'image_url', p.image_url
        )) FILTER (WHERE oi.id IS NOT NULL), '[]') as items
       FROM orders o
       LEFT JOIN order_items oi ON o.id = oi.order_id
       LEFT JOIN products p ON oi.product_id = p.id
       WHERE o.user_id = $1
       GROUP BY o.id
       ORDER BY o.created_at DESC`,
            [req.user.id]
        )
        res.json(orders.rows)
    } catch (err) {
        res.status(500).json({ message: "Error al obtener órdenes", error: err.message })
    }
}

export const getAllOrders = async (req, res) => {
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
       GROUP BY o.id, u.name, u.email
       ORDER BY o.created_at DESC`
        )
        res.json(orders.rows)
    } catch (err) {
        res.status(500).json({ message: "Error al obtener órdenes", error: err.message })
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

export const getOrderById = async (req, res) => {
    const { id } = req.params
    try {
        const order = await pool.query(
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
       WHERE o.id = $1
       GROUP BY o.id, u.name, u.email`,
            [id]
        )
        if (order.rows.length === 0)
            return res.status(404).json({ message: "Orden no encontrada" })
        const services = await pool.query(
            `SELECT sr.*, ps.title, ps.description, ps.category, ps.city
             FROM service_requests sr
             LEFT JOIN professional_services ps ON sr.service_id = ps.id
             WHERE sr.order_id=$1`,
            [id]
        )
        res.json({ ...order.rows[0], service_requests: services.rows })
    } catch (err) {
        res.status(500).json({ message: "Error al obtener orden", error: err.message })
    }
}
