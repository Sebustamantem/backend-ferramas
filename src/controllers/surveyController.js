import pool from "../config/db.js"

const ensureSurveyTable = async () => {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS satisfaction_surveys (
            id SERIAL PRIMARY KEY,
            user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
            order_id INTEGER,
            rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
            comment TEXT,
            created_at TIMESTAMP DEFAULT NOW()
        )
    `)
    await pool.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS satisfaction_surveys_user_order_unique
        ON satisfaction_surveys(user_id, order_id)
        WHERE order_id IS NOT NULL
    `)
}

export const submitSurvey = async (req, res) => {
    const { order_id, rating, comment } = req.body
    const score = Number(rating)
    if (!Number.isInteger(score) || score < 1 || score > 5) {
        return res.status(400).json({ message: "La calificacion debe estar entre 1 y 5" })
    }
    try {
        await ensureSurveyTable()
        if (order_id) {
            const order = await pool.query(
                "SELECT id FROM orders WHERE id=$1 AND user_id=$2",
                [order_id, req.user.id]
            )
            if (order.rows.length === 0) {
                return res.status(404).json({ message: "Orden no encontrada para esta encuesta" })
            }
        }

        const existing = order_id
            ? await pool.query(
                "SELECT id FROM satisfaction_surveys WHERE user_id=$1 AND order_id=$2",
                [req.user.id, order_id]
            )
            : { rows: [] }
        if (existing.rows.length > 0) {
            return res.status(409).json({ message: "Ya respondiste la encuesta de esta compra" })
        }

        const result = await pool.query(
            `INSERT INTO satisfaction_surveys (user_id, order_id, rating, comment)
             VALUES ($1, $2, $3, $4)
             RETURNING *`,
            [req.user.id, order_id || null, score, comment || null]
        )
        res.status(201).json(result.rows[0])
    } catch (err) {
        res.status(500).json({ message: "Error al registrar encuesta", error: err.message })
    }
}
