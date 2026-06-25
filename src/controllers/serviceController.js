import pool from "../config/db.js"
import { sendServiceContactEmail } from "../utils/email.js"

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
    await pool.query("ALTER TABLE professional_services ADD COLUMN IF NOT EXISTS region VARCHAR(80)")
    await pool.query("ALTER TABLE professional_services ADD COLUMN IF NOT EXISTS availability VARCHAR(160)")
    await pool.query("ALTER TABLE professional_services ADD COLUMN IF NOT EXISTS reference_price INTEGER")
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
        res.json({
            message: "Servicios obtenidos correctamente",
            services: result.rows,
        })
    } catch (err) {
        res.status(500).json({ message: "Error al obtener servicios", error: err.message })
    }
}

export const getMyServices = async (req, res) => {
    try {
        await ensureServiceTables()
        const result = await pool.query(
            `SELECT ps.*,
                    COUNT(sr.id)::int as request_count,
                    COALESCE(SUM(CASE WHEN sr.status='paid_contact_fee' THEN sr.amount ELSE 0 END), 0)::int as confirmation_total
             FROM professional_services ps
             LEFT JOIN service_requests sr ON sr.service_id = ps.id
             WHERE ps.user_id=$1
             GROUP BY ps.id
             ORDER BY ps.created_at DESC`,
            [req.user.id]
        )
        res.json({
            message: "Tus servicios fueron obtenidos correctamente",
            services: result.rows,
        })
    } catch (err) {
        res.status(500).json({ message: "Error al obtener tus servicios", error: err.message })
    }
}

export const createService = async (req, res) => {
    const { title, description, category, region, city, phone, availability, reference_price } = req.body
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
            `INSERT INTO professional_services (
                user_id, title, description, category, region, city, phone, email, availability, reference_price
             )
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
             RETURNING *`,
            [
                req.user.id,
                title,
                description,
                category || null,
                region || null,
                city || null,
                phone || null,
                user.rows[0].email,
                availability || null,
                reference_price ? Number(reference_price) : null,
            ]
        )
        res.status(201).json({
            message: "Servicio publicado correctamente",
            service: result.rows[0],
        })
    } catch (err) {
        res.status(500).json({ message: "Error al publicar servicio", error: err.message })
    }
}

export const updateService = async (req, res) => {
    const { serviceId } = req.params
    const { title, description, category, region, city, phone, availability, reference_price } = req.body
    try {
        await ensureServiceTables()
        const result = await pool.query(
            `UPDATE professional_services
             SET title=$1, description=$2, category=$3, region=$4, city=$5,
                 phone=$6, availability=$7, reference_price=$8
             WHERE id=$9 AND user_id=$10
             RETURNING *`,
            [
                title,
                description,
                category || null,
                region || null,
                city || null,
                phone || null,
                availability || null,
                reference_price ? Number(reference_price) : null,
                serviceId,
                req.user.id,
            ]
        )
        if (result.rows.length === 0) {
            return res.status(404).json({ message: "Servicio no encontrado" })
        }
        res.json({
            message: "Servicio actualizado correctamente",
            service: result.rows[0],
        })
    } catch (err) {
        res.status(500).json({ message: "Error al actualizar servicio", error: err.message })
    }
}

export const updateServiceStatus = async (req, res) => {
    const { serviceId } = req.params
    const { is_active } = req.body
    try {
        await ensureServiceTables()
        const result = await pool.query(
            `UPDATE professional_services
             SET is_active=$1
             WHERE id=$2 AND user_id=$3
             RETURNING *`,
            [Boolean(is_active), serviceId, req.user.id]
        )
        if (result.rows.length === 0) {
            return res.status(404).json({ message: "Servicio no encontrado" })
        }
        res.json({
            message: "Estado del servicio actualizado correctamente",
            service: result.rows[0],
        })
    } catch (err) {
        res.status(500).json({ message: "Error al cambiar estado del servicio", error: err.message })
    }
}

export const deleteService = async (req, res) => {
    const { serviceId } = req.params
    try {
        await ensureServiceTables()
        const result = await pool.query(
            "DELETE FROM professional_services WHERE id=$1 AND user_id=$2 RETURNING id",
            [serviceId, req.user.id]
        )
        if (result.rows.length === 0) {
            return res.status(404).json({ message: "Servicio no encontrado" })
        }
        res.json({ message: "Servicio eliminado" })
    } catch (err) {
        res.status(500).json({ message: "Error al eliminar servicio", error: err.message })
    }
}

export const getMyServiceRequests = async (req, res) => {
    try {
        await ensureServiceTables()
        const requests = await pool.query(
            `SELECT sr.*, ps.title, ps.category, ps.region, ps.city
             FROM service_requests sr
             JOIN professional_services ps ON sr.service_id = ps.id
             WHERE ps.user_id=$1
             ORDER BY sr.created_at DESC`,
            [req.user.id]
        )
        const summary = await pool.query(
            `SELECT
                COUNT(sr.id)::int as total_requests,
                COUNT(sr.id) FILTER (WHERE sr.status='paid_contact_fee')::int as paid_requests,
                COALESCE(SUM(CASE WHEN sr.status='paid_contact_fee' THEN sr.amount ELSE 0 END), 0)::int as confirmation_total
             FROM service_requests sr
             JOIN professional_services ps ON sr.service_id = ps.id
             WHERE ps.user_id=$1`,
            [req.user.id]
        )
        res.json({
            message: "Solicitudes obtenidas correctamente",
            summary: summary.rows[0],
            requests: requests.rows,
        })
    } catch (err) {
        res.status(500).json({ message: "Error al obtener solicitudes", error: err.message })
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

export const createServiceRequestsForOrder = async (client, userId, orderId, status = "pending_payment", ensureTables = true) => {
    if (ensureTables) {
        await ensureServiceTables()
    }
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

export const markServiceRequestsPaid = async (client, orderId, ensureTables = true) => {
    if (ensureTables) {
        await ensureServiceTables()
    }
    const result = await client.query(
        `UPDATE service_requests
         SET status='paid_contact_fee'
         WHERE order_id=$1 AND status <> 'cancelled'
         RETURNING *`,
        [orderId]
    )
    for (const request of result.rows) {
        await sendServiceContactEmail({ request, orderId })
        await client.query(
            "UPDATE service_requests SET contact_email_sent_at=NOW() WHERE id=$1",
            [request.id]
        )
    }
    return result.rows
}

export const cancelServiceRequestsForOrder = async (client, orderId, ensureTables = true) => {
    if (ensureTables) {
        await ensureServiceTables()
    }
    await client.query(
        "UPDATE service_requests SET status='cancelled' WHERE order_id=$1",
        [orderId]
    )
}

export const clearServiceCart = async (client, userId, ensureTables = true) => {
    if (ensureTables) {
        await ensureServiceTables()
    }
    await client.query("DELETE FROM service_cart_items WHERE user_id=$1", [userId])
}
