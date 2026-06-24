import pool from "../config/db.js"
import { ensureSurveyTable } from "./surveyController.js"
import { logActivity } from "../utils/activityLog.js"

const ensureFavoriteTable = async () => {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS favorite_products (
            id SERIAL PRIMARY KEY,
            user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
            product_id INTEGER REFERENCES products(id) ON DELETE CASCADE,
            created_at TIMESTAMP DEFAULT NOW(),
            UNIQUE(user_id, product_id)
        )
    `)
}

export const getProducts = async (req, res) => {
    try {
        const hasPagination = req.query.page || req.query.limit
        if (!hasPagination) {
            const result = await pool.query("SELECT * FROM products ORDER BY created_at DESC")
            return res.json(result.rows)
        }

        const page = Math.max(Number(req.query.page || 1), 1)
        const limit = Math.min(Math.max(Number(req.query.limit || 20), 1), 100)
        const offset = (page - 1) * limit
        const search = String(req.query.search || "").trim()
        const category = String(req.query.category || "").trim()
        const sort = String(req.query.sort || "newest")

        const where = []
        const params = []

        if (search) {
            params.push(`%${search}%`)
            where.push(`(name ILIKE $${params.length} OR description ILIKE $${params.length} OR category ILIKE $${params.length})`)
        }

        if (category) {
            params.push(category)
            where.push(`LOWER(category) = LOWER($${params.length})`)
        }

        const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : ""
        const orderSql = {
            price_asc: "price ASC",
            price_desc: "price DESC",
            newest: "created_at DESC",
        }[sort] || "created_at DESC"

        const countResult = await pool.query(`SELECT COUNT(*)::int as total FROM products ${whereSql}`, params)
        const dataResult = await pool.query(
            `SELECT * FROM products ${whereSql} ORDER BY ${orderSql} LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
            [...params, limit, offset]
        )

        res.json({
            data: dataResult.rows,
            pagination: {
                page,
                limit,
                total: Number(countResult.rows[0]?.total || 0),
                total_pages: Math.max(Math.ceil(Number(countResult.rows[0]?.total || 0) / limit), 1),
            },
        })
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
        await logActivity({
            userId: req.user.id,
            action: "product_created",
            entityType: "product",
            entityId: result.rows[0].id,
            description: "Admin creo producto",
            metadata: { stock: Number(stock || 0), price: Number(price || 0) },
        }).catch((logErr) => console.error("Error registrando actividad:", logErr.message))
        res.status(201).json(result.rows[0])
    } catch (err) {
        res.status(500).json({ message: "Error al crear producto", error: err.message })
    }
}

export const updateProduct = async (req, res) => {
    const { id } = req.params
    const { name, description, price, stock, category } = req.body
    try {
        const previous = await pool.query("SELECT stock FROM products WHERE id = $1", [id])
        if (previous.rows.length === 0)
            return res.status(404).json({ message: "Producto no encontrado" })
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
        await logActivity({
            userId: req.user.id,
            action: "product_updated",
            entityType: "product",
            entityId: Number(id),
            description: "Admin actualizo producto",
            metadata: {
                previous_stock: Number(previous.rows[0].stock || 0),
                new_stock: Number(stock || 0),
            },
        }).catch((logErr) => console.error("Error registrando actividad:", logErr.message))
        res.json(result.rows[0])
    } catch (err) {
        res.status(500).json({ message: "Error al actualizar producto", error: err.message })
    }
}

export const deleteProduct = async (req, res) => {
    const { id } = req.params
    try {
        await pool.query("DELETE FROM products WHERE id = $1", [id])
        await logActivity({
            userId: req.user.id,
            action: "product_deleted",
            entityType: "product",
            entityId: Number(id),
            description: "Admin elimino producto",
        }).catch((logErr) => console.error("Error registrando actividad:", logErr.message))
        res.json({ message: "Producto eliminado correctamente" })
    } catch (err) {
        res.status(500).json({ message: "Error al eliminar producto", error: err.message })
    }
}

export const getMyFavoriteProducts = async (req, res) => {
    try {
        await ensureFavoriteTable()
        const result = await pool.query(
            `SELECT p.*, fp.created_at as favorite_created_at
             FROM favorite_products fp
             JOIN products p ON fp.product_id = p.id
             WHERE fp.user_id=$1
             ORDER BY fp.created_at DESC`,
            [req.user.id]
        )
        res.json(result.rows)
    } catch (err) {
        res.status(500).json({ message: "Error al obtener favoritos", error: err.message })
    }
}

export const toggleFavoriteProduct = async (req, res) => {
    const { id } = req.params
    try {
        await ensureFavoriteTable()
        const product = await pool.query("SELECT id FROM products WHERE id=$1", [id])
        if (product.rows.length === 0) {
            return res.status(404).json({ message: "Producto no encontrado" })
        }

        const existing = await pool.query(
            "SELECT id FROM favorite_products WHERE user_id=$1 AND product_id=$2",
            [req.user.id, id]
        )
        if (existing.rows.length > 0) {
            await pool.query("DELETE FROM favorite_products WHERE id=$1", [existing.rows[0].id])
            return res.json({ is_favorite: false })
        }

        await pool.query(
            "INSERT INTO favorite_products (user_id, product_id) VALUES ($1, $2)",
            [req.user.id, id]
        )
        res.status(201).json({ is_favorite: true })
    } catch (err) {
        res.status(500).json({ message: "Error al actualizar favorito", error: err.message })
    }
}

export const getProductReviews = async (req, res) => {
    const { id } = req.params
    try {
        await ensureSurveyTable()
        const reviews = await pool.query(
            `SELECT ss.id, ss.order_id, ss.rating, ss.comment, ss.created_at,
                    u.name as user_name, u.lastname as user_lastname
             FROM satisfaction_surveys ss
             JOIN orders o ON o.id = ss.order_id
             JOIN order_items oi ON oi.order_id = o.id
             LEFT JOIN users u ON u.id = ss.user_id
             WHERE oi.product_id = $1
             ORDER BY ss.created_at DESC`,
            [id]
        )
        const summary = await pool.query(
            `SELECT
                COUNT(*)::int as total,
                COALESCE(ROUND(AVG(ss.rating)::numeric, 1), 0) as average_rating,
                COUNT(*) FILTER (WHERE ss.rating = 5)::int as five,
                COUNT(*) FILTER (WHERE ss.rating = 4)::int as four,
                COUNT(*) FILTER (WHERE ss.rating = 3)::int as three,
                COUNT(*) FILTER (WHERE ss.rating = 2)::int as two,
                COUNT(*) FILTER (WHERE ss.rating = 1)::int as one
             FROM satisfaction_surveys ss
             JOIN orders o ON o.id = ss.order_id
             JOIN order_items oi ON oi.order_id = o.id
             WHERE oi.product_id = $1`,
            [id]
        )
        res.json({
            total: Number(summary.rows[0]?.total || 0),
            average_rating: Number(summary.rows[0]?.average_rating || 0),
            distribution: {
                5: Number(summary.rows[0]?.five || 0),
                4: Number(summary.rows[0]?.four || 0),
                3: Number(summary.rows[0]?.three || 0),
                2: Number(summary.rows[0]?.two || 0),
                1: Number(summary.rows[0]?.one || 0),
            },
            reviews: reviews.rows,
        })
    } catch (err) {
        res.status(500).json({ message: "Error al obtener opiniones", error: err.message })
    }
}
