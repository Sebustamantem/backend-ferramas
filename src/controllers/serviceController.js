import pool from "../config/db.js"

const SERVICE_PRICE = 5000

export const ensureServiceTables = async () => {
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
    await pool.query(`
        CREATE TABLE IF NOT EXISTS service_cart_items (
            id SERIAL PRIMARY KEY,
            user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
            service_id INTEGER REFERENCES professional_services(id) ON DELETE CASCADE,
            created_at TIMESTAMP DEFAULT NOW(),
            UNIQUE(user_id, service_id)
        )
    `)
    await pool.query("ALTER TABLE service_requests ADD COLUMN IF NOT EXISTS order_id INTEGER")
    await pool.query("ALTER TABLE service_requests ADD COLUMN IF NOT EXISTS professional_name VARCHAR(160)")
    await pool.query("ALTER TABLE service_requests ADD COLUMN IF NOT EXISTS professional_email VARCHAR(160)")
    await pool.query("ALTER TABLE service_requests ADD COLUMN IF NOT EXISTS professional_phone VARCHAR(40)")
    await pool.query("ALTER TABLE service_requests ADD COLUMN IF NOT EXISTS contact_email_sent_at TIMESTAMP")
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

export const addServiceToCart = async (req, res) => {
    const { serviceId } = req.params
    try {
        await ensureServiceTables()
        const service = await pool.query(
            "SELECT id FROM professional_services WHERE id=$1 AND is_active=TRUE",
            [serviceId]
        )
        if (service.rows.length === 0) {
            return res.status(404).json({ message: "Servicio no encontrado" })
        }
        await pool.query(
            `INSERT INTO service_cart_items (user_id, service_id)
             VALUES ($1, $2)
             ON CONFLICT (user_id, service_id) DO NOTHING`,
            [req.user.id, serviceId]
        )
        res.status(201).json({ message: "Asesoria agregada al carrito" })
    } catch (err) {
        res.status(500).json({ message: "Error al agregar asesoria", error: err.message })
    }
}

export const removeServiceFromCart = async (req, res) => {
    const { serviceId } = req.params
    try {
        await ensureServiceTables()
        await pool.query(
            "DELETE FROM service_cart_items WHERE user_id=$1 AND service_id=$2",
            [req.user.id, serviceId]
        )
        res.json({ message: "Asesoria eliminada del carrito" })
    } catch (err) {
        res.status(500).json({ message: "Error al eliminar asesoria", error: err.message })
    }
}

export const createServiceRequestsForOrder = async (client, userId, orderId, status = "pending_payment") => {
    await ensureServiceTables()
    const customerResult = await client.query(
        "SELECT name, lastname, email, phone FROM users WHERE id=$1",
        [userId]
    )
    const customer = customerResult.rows[0]
    const services = await client.query(
        `SELECT ps.*, u.name as professional_name, u.lastname as professional_lastname, u.email as professional_email
         FROM service_cart_items sci
         JOIN professional_services ps ON sci.service_id = ps.id
         JOIN users u ON ps.user_id = u.id
         WHERE sci.user_id=$1`,
        [userId]
    )

    for (const service of services.rows) {
        await client.query(
            `INSERT INTO service_requests (
                service_id, client_id, order_id, customer_name, customer_email, customer_phone,
                professional_name, professional_email, professional_phone, status, amount
             )
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
            [
                service.id,
                userId,
                orderId,
                `${customer.name || ""} ${customer.lastname || ""}`.trim(),
                customer.email,
                customer.phone,
                `${service.professional_name || ""} ${service.professional_lastname || ""}`.trim(),
                service.professional_email || service.email,
                service.phone,
                status,
                SERVICE_PRICE,
            ]
        )
    }
    return services.rows.length
}

export const markServiceRequestsPaid = async (client, orderId) => {
    await ensureServiceTables()
    const result = await client.query(
        `UPDATE service_requests
         SET status='paid_contact_fee'
         WHERE order_id=$1 AND status <> 'cancelled'
         RETURNING *`,
        [orderId]
    )
    for (const request of result.rows) {
        console.log("Correo mixto servicio Ferremas:", {
            to: [request.customer_email, request.professional_email].filter(Boolean),
            subject: `Contacto por asesoria FERREMAS - Pedido #${orderId}`,
            cliente: {
                nombre: request.customer_name,
                email: request.customer_email,
                telefono: request.customer_phone,
            },
            profesional: {
                nombre: request.professional_name,
                email: request.professional_email,
                telefono: request.professional_phone,
            },
            monto_confirmacion: request.amount,
            nota: "FERREMAS solo cobra la confirmacion de contacto. El servicio final se acuerda y paga directamente entre cliente y maestro/PYME.",
        })
        await client.query(
            "UPDATE service_requests SET contact_email_sent_at=NOW() WHERE id=$1",
            [request.id]
        )
    }
    return result.rows
}

export const cancelServiceRequestsForOrder = async (client, orderId) => {
    await ensureServiceTables()
    await client.query(
        "UPDATE service_requests SET status='cancelled' WHERE order_id=$1",
        [orderId]
    )
}

export const clearServiceCart = async (client, userId) => {
    await ensureServiceTables()
    await client.query("DELETE FROM service_cart_items WHERE user_id=$1", [userId])
}
