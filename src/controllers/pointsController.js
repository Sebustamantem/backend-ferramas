import pool from "../config/db.js"

export const ensurePointsTables = async () => {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS user_points (
            user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
            balance INTEGER NOT NULL DEFAULT 0,
            updated_at TIMESTAMP DEFAULT NOW()
        )
    `)
    await pool.query(`
        CREATE TABLE IF NOT EXISTS point_transactions (
            id SERIAL PRIMARY KEY,
            user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
            order_id INTEGER,
            type VARCHAR(20) NOT NULL,
            points INTEGER NOT NULL,
            description TEXT,
            created_at TIMESTAMP DEFAULT NOW()
        )
    `)
}

export const getMyPoints = async (req, res) => {
    try {
        await ensurePointsTables()
        const result = await pool.query(
            "SELECT balance FROM user_points WHERE user_id=$1",
            [req.user.id]
        )
        res.json({ balance: Number(result.rows[0]?.balance || 0) })
    } catch (err) {
        res.status(500).json({ message: "Error al obtener puntos", error: err.message })
    }
}

export const calculatePointsForAmount = (amount) => {
    const purchaseAmount = Number(amount || 0)
    if (purchaseAmount <= 0) return 0
    if (purchaseAmount >= 50000) return 250
    if (purchaseAmount >= 30000) return 200
    if (purchaseAmount >= 10000) return 150
    return 100
}

export const addPointsForOrder = async (client, userId, orderId, amount) => {
    const points = calculatePointsForAmount(amount)
    if (points <= 0) return 0

    const existing = await client.query(
        "SELECT id FROM point_transactions WHERE order_id=$1 AND type='earned' LIMIT 1",
        [orderId]
    )
    if (existing.rows.length > 0) return 0

    await client.query(
        `INSERT INTO user_points (user_id, balance)
         VALUES ($1, $2)
         ON CONFLICT (user_id)
         DO UPDATE SET balance = user_points.balance + $2, updated_at = NOW()`,
        [userId, points]
    )
    await client.query(
        `INSERT INTO point_transactions (user_id, order_id, type, points, description)
         VALUES ($1, $2, 'earned', $3, 'Puntos por compra')`,
        [userId, orderId, points]
    )
    return points
}

export const usePointsForOrder = async (client, userId, orderId, requestedPoints, maxAmount) => {
    const pointsToUse = Math.max(0, Math.floor(Number(requestedPoints || 0)))
    if (pointsToUse <= 0) return 0

    const current = await client.query(
        "SELECT balance FROM user_points WHERE user_id=$1 FOR UPDATE",
        [userId]
    )
    const balance = Number(current.rows[0]?.balance || 0)
    const usable = Math.min(balance, pointsToUse, Math.floor(Number(maxAmount || 0)))
    if (usable <= 0) return 0

    await client.query(
        `UPDATE user_points
         SET balance = balance - $1, updated_at = NOW()
         WHERE user_id=$2`,
        [usable, userId]
    )
    await client.query(
        `INSERT INTO point_transactions (user_id, order_id, type, points, description)
         VALUES ($1, $2, 'used', $3, 'Descuento por puntos')`,
        [userId, orderId, usable]
    )
    return usable
}

export const restoreUsedPointsForOrder = async (client, userId, orderId, description = "Devolucion de puntos") => {
    const result = await client.query(
        `SELECT
            COALESCE(SUM(CASE WHEN type='used' THEN points ELSE 0 END), 0) as used,
            COALESCE(SUM(CASE WHEN type='refunded' THEN points ELSE 0 END), 0) as refunded
         FROM point_transactions
         WHERE order_id=$1`,
        [orderId]
    )
    const used = Number(result.rows[0]?.used || 0)
    const refunded = Number(result.rows[0]?.refunded || 0)
    const pointsToRestore = Math.max(used - refunded, 0)
    if (pointsToRestore <= 0) return 0

    await client.query(
        `INSERT INTO user_points (user_id, balance)
         VALUES ($1, $2)
         ON CONFLICT (user_id)
         DO UPDATE SET balance = user_points.balance + $2, updated_at = NOW()`,
        [userId, pointsToRestore]
    )
    await client.query(
        `INSERT INTO point_transactions (user_id, order_id, type, points, description)
         VALUES ($1, $2, 'refunded', $3, $4)`,
        [userId, orderId, pointsToRestore, description]
    )
    return pointsToRestore
}
