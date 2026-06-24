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
            password_reset_token VARCHAR(255),
            password_reset_expires TIMESTAMP,
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
    await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS password_reset_token VARCHAR(255)")
    await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS password_reset_expires TIMESTAMP")
    await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW()")
}

export const ensureCommerceTables = async () => {
    await ensureUsersTable()

    await pool.query(`
        CREATE TABLE IF NOT EXISTS products (
            id SERIAL PRIMARY KEY,
            name VARCHAR(180) NOT NULL,
            description TEXT,
            price NUMERIC(12, 2) NOT NULL DEFAULT 0,
            stock INTEGER NOT NULL DEFAULT 0,
            image_url TEXT,
            image_urls JSONB NOT NULL DEFAULT '[]'::jsonb,
            category VARCHAR(80),
            created_at TIMESTAMP DEFAULT NOW()
        )
    `)
    await pool.query("ALTER TABLE products ADD COLUMN IF NOT EXISTS image_urls JSONB NOT NULL DEFAULT '[]'::jsonb")

    await pool.query(`
        CREATE TABLE IF NOT EXISTS cart_items (
            id SERIAL PRIMARY KEY,
            user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
            product_id INTEGER REFERENCES products(id) ON DELETE CASCADE,
            quantity INTEGER NOT NULL DEFAULT 1,
            created_at TIMESTAMP DEFAULT NOW(),
            UNIQUE(user_id, product_id)
        )
    `)

    await pool.query(`
        CREATE TABLE IF NOT EXISTS stock_reservations (
            id SERIAL PRIMARY KEY,
            user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
            product_id INTEGER REFERENCES products(id) ON DELETE CASCADE,
            quantity INTEGER NOT NULL DEFAULT 1,
            expires_at TIMESTAMP NOT NULL,
            created_at TIMESTAMP DEFAULT NOW()
        )
    `)

    await pool.query(`
        CREATE TABLE IF NOT EXISTS orders (
            id SERIAL PRIMARY KEY,
            user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
            total NUMERIC(12, 2) NOT NULL DEFAULT 0,
            status VARCHAR(40) NOT NULL DEFAULT 'pending',
            address JSONB,
            transbank_token TEXT,
            created_at TIMESTAMP DEFAULT NOW()
        )
    `)
    await pool.query("ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_method VARCHAR(30) DEFAULT 'delivery'")

    await pool.query(`
        CREATE TABLE IF NOT EXISTS order_items (
            id SERIAL PRIMARY KEY,
            order_id INTEGER REFERENCES orders(id) ON DELETE CASCADE,
            product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
            quantity INTEGER NOT NULL DEFAULT 1,
            price NUMERIC(12, 2) NOT NULL DEFAULT 0,
            created_at TIMESTAMP DEFAULT NOW()
        )
    `)

    await pool.query(`
        CREATE TABLE IF NOT EXISTS favorite_products (
            id SERIAL PRIMARY KEY,
            user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
            product_id INTEGER REFERENCES products(id) ON DELETE CASCADE,
            created_at TIMESTAMP DEFAULT NOW(),
            UNIQUE(user_id, product_id)
        )
    `)

    await pool.query(`
        CREATE TABLE IF NOT EXISTS ferre_credits (
            id SERIAL PRIMARY KEY,
            user_id INTEGER UNIQUE REFERENCES users(id) ON DELETE CASCADE,
            credit_limit NUMERIC(12, 2) NOT NULL DEFAULT 0,
            balance_used NUMERIC(12, 2) NOT NULL DEFAULT 0,
            is_active BOOLEAN NOT NULL DEFAULT FALSE,
            created_at TIMESTAMP DEFAULT NOW(),
            updated_at TIMESTAMP DEFAULT NOW()
        )
    `)

    await pool.query(`
        CREATE TABLE IF NOT EXISTS ferre_credit_installments (
            id SERIAL PRIMARY KEY,
            user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
            order_id INTEGER REFERENCES orders(id) ON DELETE SET NULL,
            total_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
            installments INTEGER NOT NULL DEFAULT 1,
            amount_per_installment NUMERIC(12, 2) NOT NULL DEFAULT 0,
            paid_installments INTEGER NOT NULL DEFAULT 0,
            status VARCHAR(30) NOT NULL DEFAULT 'active',
            created_at TIMESTAMP DEFAULT NOW()
        )
    `)
    await pool.query("ALTER TABLE ferre_credit_installments ADD COLUMN IF NOT EXISTS due_date TIMESTAMP")

    await pool.query(`
        CREATE TABLE IF NOT EXISTS ferre_credit_payments (
            id SERIAL PRIMARY KEY,
            installment_id INTEGER REFERENCES ferre_credit_installments(id) ON DELETE CASCADE,
            user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
            amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
            created_at TIMESTAMP DEFAULT NOW()
        )
    `)
}

export const bootstrapAdmin = async () => {
    await ensureUsersTable()

    const email = process.env.BOOTSTRAP_ADMIN_EMAIL || DEFAULT_ADMIN_EMAIL
    const rut = process.env.BOOTSTRAP_ADMIN_RUT || DEFAULT_ADMIN_RUT
    const phone = process.env.BOOTSTRAP_ADMIN_PHONE || "+56900000000"

    const existingAdmin = await pool.query(
        "SELECT id, email, must_change_password FROM users WHERE role='admin' ORDER BY id ASC LIMIT 1"
    )

    if (existingAdmin.rows.length > 0) {
        const admin = existingAdmin.rows[0]
        const forceReset = process.env.FORCE_RESET_BOOTSTRAP_ADMIN_PASSWORD === "true"

        if (forceReset) {
            const temporaryPassword = process.env.BOOTSTRAP_ADMIN_PASSWORD || generateTemporaryPassword()
            const hashedPassword = await bcrypt.hash(temporaryPassword, 10)
            await pool.query(
                `UPDATE users
                 SET password=$1, must_change_password=TRUE
                 WHERE id=$2`,
                [hashedPassword, admin.id]
            )
            return {
                created: false,
                reset: true,
                email: admin.email,
                temporaryPassword,
                forced: true,
            }
        }

        return {
            created: false,
            reset: false,
            email: admin.email,
            passwordAlreadyChanged: !admin.must_change_password,
            passwordChangePending: admin.must_change_password,
        }
    }

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
