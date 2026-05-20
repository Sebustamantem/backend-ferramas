import pool from "../config/db.js"

export const getProducts = async (req, res) => {
    try {
        const result = await pool.query("SELECT * FROM products ORDER BY created_at DESC")
        res.json(result.rows)
    } catch (err) {
        res.status(500).json({ message: "Error al obtener productos", error: err.message })
    }
}

export const getProductById = async (req, res) => {
    const { id } = req.params
    try {
        const result = await pool.query("SELECT * FROM products WHERE id = $1", [id])
        if (result.rows.length === 0)
            return res.status(404).json({ message: "Producto no encontrado" })
        res.json(result.rows[0])
    } catch (err) {
        res.status(500).json({ message: "Error al obtener producto", error: err.message })
    }
}

export const createProduct = async (req, res) => {
    const { name, description, price, stock, category } = req.body
    const image_url = req.file ? req.file.path : null
    try {
        const result = await pool.query(
            "INSERT INTO products (name, description, price, stock, image_url, category) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *",
            [name, description, price, stock, image_url, category]
        )
        res.status(201).json(result.rows[0])
    } catch (err) {
        res.status(500).json({ message: "Error al crear producto", error: err.message })
    }
}

export const updateProduct = async (req, res) => {
    const { id } = req.params
    const { name, description, price, stock, category } = req.body
    try {
        let image_url
        if (req.file) {
            image_url = req.file.path
        } else {
            const current = await pool.query("SELECT image_url FROM products WHERE id = $1", [id])
            if (current.rows.length === 0)
                return res.status(404).json({ message: "Producto no encontrado" })
            image_url = current.rows[0].image_url
        }
        const result = await pool.query(
            "UPDATE products SET name=$1, description=$2, price=$3, stock=$4, image_url=$5, category=$6 WHERE id=$7 RETURNING *",
            [name, description, price, stock, image_url, category, id]
        )
        if (result.rows.length === 0)
            return res.status(404).json({ message: "Producto no encontrado" })
        res.json(result.rows[0])
    } catch (err) {
        res.status(500).json({ message: "Error al actualizar producto", error: err.message })
    }
}

export const deleteProduct = async (req, res) => {
    const { id } = req.params
    try {
        await pool.query("DELETE FROM products WHERE id = $1", [id])
        res.json({ message: "Producto eliminado correctamente" })
    } catch (err) {
        res.status(500).json({ message: "Error al eliminar producto", error: err.message })
    }
}