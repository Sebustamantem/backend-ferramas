import pool from "../config/db.js"

const SERVICE_PRICE = 5000

const ensureServiceTables = async () => {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS professional_services (
            id SERIAL PRIMARY KEY,
            user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
            title VARCHAR(120) NOT NULL,
            description TEXT NOT NULL,
            category VARCHAR(80),
            city VARCHAR(80),
            phone VARCHAR(40),
            email VARCHAR(160),
            is_active BOOLEAN DEFAULT TRUE,
            created_at TIMESTAMP DEFAULT NOW()
        )
    `)
    await pool.query(`
        CREATE TABLE IF NOT EXISTS service_requests (
            id SERIAL PRIMARY KEY,
            service_id INTEGER REFERENCES professional_services(id) ON DELETE SET NULL,
            client_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
            customer_name VARCHAR(160),
            customer_email VARCHAR(160),
            customer_phone VARCHAR(40),
            status VARCHAR(30) DEFAULT 'paid_contact_fee',
            amount INTEGER DEFAULT ${SERVICE_PRICE},
            created_at TIMESTAMP DEFAULT NOW()
        )
    `)
}

export const getServices = async (req, res) => {
    try {
        await ensureServiceTables()
        const result = await pool.query(
            `SELECT ps.*, u.name, u.lastname, u.user_type
             FROM professional_services ps
             JOIN users u ON ps.user_id = u.id
             WHERE ps.is_active = TRUE
             ORDER BY ps.created_at DESC`
        )
        res.json(result.rows)
    } catch (err) {
        res.status(500).json({ message: "Error al obtener servicios", error: err.message })
    }
}

export const getMyServices = async (req, res) => {
    try {
        await ensureServiceTables()
        const result = await pool.query(
            "SELECT * FROM professional_services WHERE user_id=$1 ORDER BY created_at DESC",
            [req.user.id]
        )
        res.json(result.rows)
    } catch (err) {
        res.status(500).json({ message: "Error al obtener tus servicios", error: err.message })
    }
}

export const createService = async (req, res) => {
    const { title, description, category, city, phone } = req.body
    try {
        await ensureServiceTables()
        const user = await pool.query(
            "SELECT email, user_type FROM users WHERE id=$1",
            [req.user.id]
        )
        if (!["maestro", "pyme"].includes(user.rows[0]?.user_type)) {
            return res.status(403).json({ message: "Solo maestros y PYMEs aprobados pueden publicar servicios" })
        }
        const result = await pool.query(
            `INSERT INTO professional_services (user_id, title, description, category, city, phone, email)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             RETURNING *`,
            [req.user.id, title, description, category || null, city || null, phone || null, user.rows[0].email]
        )
        res.status(201).json(result.rows[0])
    } catch (err) {
        res.status(500).json({ message: "Error al publicar servicio", error: err.message })
    }
}

export const requestServiceContact = async (req, res) => {
    const { serviceId } = req.params
    try {
        await ensureServiceTables()
        const service = await pool.query(
            `SELECT ps.*, u.name as professional_name, u.email as professional_email
             FROM professional_services ps
             JOIN users u ON ps.user_id = u.id
             WHERE ps.id=$1 AND ps.is_active=TRUE`,
            [serviceId]
        )
        if (service.rows.length === 0) {
            return res.status(404).json({ message: "Servicio no encontrado" })
        }

        const client = await pool.query(
            "SELECT name, lastname, email, phone FROM users WHERE id=$1",
            [req.user.id]
        )
        const customer = client.rows[0]
        const result = await pool.query(
            `INSERT INTO service_requests (service_id, client_id, customer_name, customer_email, customer_phone)
             VALUES ($1, $2, $3, $4, $5)
             RETURNING *`,
            [
                serviceId,
                req.user.id,
                `${customer.name || ""} ${customer.lastname || ""}`.trim(),
                customer.email,
                customer.phone,
            ]
        )

        res.status(201).json({
            ...result.rows[0],
            amount: SERVICE_PRICE,
            service: service.rows[0],
            message: "Contacto registrado. Se debe enviar correo mixto al cliente y maestro/PYME.",
        })
    } catch (err) {
        res.status(500).json({ message: "Error al solicitar contacto", error: err.message })
    }
}
