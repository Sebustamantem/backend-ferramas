import bcrypt from "bcryptjs"
import crypto from "crypto"
import pool from "./db.js"

const DEFAULT_ADMIN_EMAIL = "admin@ferremas.cl"
const DEFAULT_ADMIN_RUT = "11.111.111-1"

const generateTemporaryPassword = () => {
    const random = crypto.randomBytes(6).toString("base64url")
    return `Ferre${random}1`
}

export const ensureUsersTable = async () => {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS users (
            id SERIAL PRIMARY KEY,
            name VARCHAR(120) NOT NULL,
            lastname VARCHAR(120),
            email VARCHAR(160) NOT NULL UNIQUE,
            password VARCHAR(255) NOT NULL,
            rut VARCHAR(40) UNIQUE,
            phone VARCHAR(40),
            role VARCHAR(30) NOT NULL DEFAULT 'cliente',
            user_type VARCHAR(40) NOT NULL DEFAULT 'cliente',
            business_name VARCHAR(160),
            profession VARCHAR(160),
            address JSONB,
            first_purchase_used BOOLEAN NOT NULL DEFAULT FALSE,
            must_change_password BOOLEAN NOT NULL DEFAULT FALSE,
            created_at TIMESTAMP DEFAULT NOW()
        )
    `)

    await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS lastname VARCHAR(120)")
    await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS rut VARCHAR(40)")
    await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS phone VARCHAR(40)")
    await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS role VARCHAR(30) NOT NULL DEFAULT 'cliente'")
    await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS user_type VARCHAR(40) NOT NULL DEFAULT 'cliente'")
    await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS business_name VARCHAR(160)")
    await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS profession VARCHAR(160)")
    await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS address JSONB")
    await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS first_purchase_used BOOLEAN NOT NULL DEFAULT FALSE")
    await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT FALSE")
    await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW()")
}

export const bootstrapAdmin = async () => {
    await ensureUsersTable()

    const existingAdmin = await pool.query("SELECT id FROM users WHERE role='admin' LIMIT 1")
    if (existingAdmin.rows.length > 0) {
        return { created: false }
    }

    const email = process.env.BOOTSTRAP_ADMIN_EMAIL || DEFAULT_ADMIN_EMAIL
    const rut = process.env.BOOTSTRAP_ADMIN_RUT || DEFAULT_ADMIN_RUT
    const phone = process.env.BOOTSTRAP_ADMIN_PHONE || "+56900000000"
    const temporaryPassword = process.env.BOOTSTRAP_ADMIN_PASSWORD || generateTemporaryPassword()
    const hashedPassword = await bcrypt.hash(temporaryPassword, 10)
    const existingRut = await pool.query("SELECT id FROM users WHERE rut=$1", [rut])
    const adminRut = existingRut.rows.length > 0 ? null : rut

    const existingEmail = await pool.query("SELECT id FROM users WHERE LOWER(email)=LOWER($1)", [email])
    if (existingEmail.rows.length > 0) {
        await pool.query(
            `UPDATE users
             SET role='admin', user_type='cliente', password=$1, must_change_password=TRUE
             WHERE id=$2`,
            [hashedPassword, existingEmail.rows[0].id]
        )
    } else {
        await pool.query(
            `INSERT INTO users (
                name, lastname, email, password, rut, phone, role, user_type, must_change_password
             )
             VALUES ($1, $2, $3, $4, $5, $6, 'admin', 'cliente', TRUE)`,
            ["Admin", "Ferremas", email, hashedPassword, adminRut, phone]
        )
    }

    return {
        created: true,
        email,
        temporaryPassword,
    }
}
