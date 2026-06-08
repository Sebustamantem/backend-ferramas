import pool from "../config/db.js"

export const ensureActivityLogTable = async () => {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS activity_logs (
            id SERIAL PRIMARY KEY,
            user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
            action VARCHAR(80) NOT NULL,
            entity_type VARCHAR(80) NOT NULL,
            entity_id INTEGER,
            description TEXT NOT NULL DEFAULT '',
            metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
            created_at TIMESTAMP DEFAULT NOW()
        )
    `)
}

export const logActivity = async ({ userId = null, action, entityType, entityId = null, description = "", metadata = {} }) => {
    await ensureActivityLogTable()
    await pool.query(
        `INSERT INTO activity_logs (user_id, action, entity_type, entity_id, description, metadata)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [userId, action, entityType, entityId, description, JSON.stringify(metadata || {})]
    )
}

export const getRecentActivityLogs = async (limit = 12) => {
    await ensureActivityLogTable()
    const result = await pool.query(
        `SELECT al.*, u.name as user_name, u.lastname as user_lastname, u.email as user_email, u.role as user_role
         FROM activity_logs al
         LEFT JOIN users u ON u.id = al.user_id
         ORDER BY al.created_at DESC
         LIMIT $1`,
        [limit]
    )
    return result.rows
}

export const getActivityLogs = async ({ action = "", entityType = "", userId = "", dateFrom = "", dateTo = "", limit = 80 }) => {
    await ensureActivityLogTable()
    const filters = []
    const values = []

    if (action) {
        values.push(`%${action}%`)
        filters.push(`al.action ILIKE $${values.length}`)
    }
    if (entityType) {
        values.push(entityType)
        filters.push(`al.entity_type = $${values.length}`)
    }
    if (userId) {
        values.push(Number(userId))
        filters.push(`al.user_id = $${values.length}`)
    }
    if (dateFrom) {
        values.push(dateFrom)
        filters.push(`al.created_at::date >= $${values.length}::date`)
    }
    if (dateTo) {
        values.push(dateTo)
        filters.push(`al.created_at::date <= $${values.length}::date`)
    }

    values.push(Math.min(Math.max(Number(limit) || 80, 1), 300))
    const where = filters.length ? `WHERE ${filters.join(" AND ")}` : ""
    const result = await pool.query(
        `SELECT al.*, u.name as user_name, u.lastname as user_lastname, u.email as user_email, u.role as user_role
         FROM activity_logs al
         LEFT JOIN users u ON u.id = al.user_id
         ${where}
         ORDER BY al.created_at DESC
         LIMIT $${values.length}`,
        values
    )
    return result.rows
}
