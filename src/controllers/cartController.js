import pool from "../config/db.js"

export const getCart = async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT ci.id, p.name, p.price, p.image_url, ci.quantity
       FROM cart_items ci
       JOIN products p ON ci.product_id = p.id
       WHERE ci.user_id = $1`,
            [req.user.id]
        )
        res.json(result.rows)
    } catch (err) {
        res.status(500).json({ message: "Error al obtener carrito", error: err.message })
    }
}

export const addToCart = async (req, res) => {
    const { product_id, quantity = 1 } = req.body
    try {
        const exists = await pool.query(
            "SELECT id, quantity FROM cart_items WHERE user_id = $1 AND product_id = $2",
            [req.user.id, product_id]
        )
        if (exists.rows.length > 0) {
            const updated = await pool.query(
                "UPDATE cart_items SET quantity = quantity + $1 WHERE id = $2 RETURNING *",
                [quantity, exists.rows[0].id]
            )
            return res.json(updated.rows[0])
        }
        const result = await pool.query(
            "INSERT INTO cart_items (user_id, product_id, quantity) VALUES ($1, $2, $3) RETURNING *",
            [req.user.id, product_id, quantity]
        )
        res.status(201).json(result.rows[0])
    } catch (err) {
        res.status(500).json({ message: "Error al agregar al carrito", error: err.message })
    }
}

export const removeFromCart = async (req, res) => {
    const { productId } = req.params
    try {
        await pool.query(
            "DELETE FROM cart_items WHERE user_id = $1 AND product_id = $2",
            [req.user.id, productId]
        )
        res.json({ message: "Producto eliminado del carrito" })
    } catch (err) {
        res.status(500).json({ message: "Error al eliminar del carrito", error: err.message })
    }
}