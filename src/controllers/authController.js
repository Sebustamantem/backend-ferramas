import bcrypt from "bcryptjs"
import jwt from "jsonwebtoken"
import pool from "../config/db.js"
import { ensureUsersTable } from "../config/bootstrapAdmin.js"
import { formatRut, isRutLengthValid } from "../utils/rut.js"

const normalizeRut = (rut = "") => String(rut).replace(/[^0-9kK]/g, "").toLowerCase()

export const register = async (req, res) => {
    const { name, lastname, email, password, rut, phone, user_type, business_name, profession } = req.body
    try {
        await ensureUsersTable()
        if (!isRutLengthValid(rut))
            return res.status(400).json({ message: "RUT invalido" })
        const formattedRut = formatRut(rut)
        const exists = await pool.query("SELECT id FROM users WHERE email = $1", [email])
        if (exists.rows.length > 0)
            return res.status(400).json({ message: "El email ya está registrado" })

        const rutExists = await pool.query("SELECT id FROM users WHERE rut = $1", [formattedRut])
        if (rutExists.rows.length > 0)
            return res.status(400).json({ message: "El RUT ya está registrado" })

        const hashed = await bcrypt.hash(password, 10)
        const allowedTypes = ["cliente", "maestro", "pyme"]
        const requestedType = allowedTypes.includes(user_type) ? user_type : "cliente"
        const type = ["maestro", "pyme"].includes(requestedType) ? `${requestedType}_pending` : requestedType

        const result = await pool.query(
            `INSERT INTO users (name, lastname, email, password, rut, phone, role, user_type, business_name, profession)
       VALUES ($1, $2, $3, $4, $5, $6, 'cliente', $7, $8, $9)
       RETURNING id, name, lastname, email, phone, rut, role, user_type, business_name, profession, address`,
            [name, lastname, email, hashed, formattedRut, phone, type, business_name || null, profession || null]
        )

        const user = result.rows[0]
        const token = jwt.sign({ id: user.id, role: user.role }, process.env.JWT_SECRET, { expiresIn: "7d" })
        res.status(201).json({ user, token })
    } catch (err) {
        res.status(500).json({ message: "Error en el servidor", error: err.message })
    }
}

export const login = async (req, res) => {
    const { email, password } = req.body
    const identifier = String(email || "").trim()
    try {
        await ensureUsersTable()
        const result = await pool.query(
            `SELECT *
             FROM users
             WHERE LOWER(email) = LOWER($1)
                OR LOWER(name) = LOWER($1)
             LIMIT 1`,
            [identifier]
        )
        if (result.rows.length === 0)
            return res.status(400).json({ message: "Credenciales inválidas" })

        const user = result.rows[0]
        const valid = await bcrypt.compare(password, user.password)
        if (!valid)
            return res.status(400).json({ message: "Credenciales inválidas" })

        const mustChangePassword = Boolean(user.must_change_password)
            || (user.role === "admin" && normalizeRut(password) === normalizeRut(user.rut))
        const token = jwt.sign({ id: user.id, role: user.role }, process.env.JWT_SECRET, { expiresIn: "7d" })
        res.json({
            user: {
                id: user.id, name: user.name, lastname: user.lastname,
                email: user.email, role: user.role, phone: user.phone,
                rut: user.rut, user_type: user.user_type,
                business_name: user.business_name, profession: user.profession,
                first_purchase_used: user.first_purchase_used,
                address: user.address || null,
                must_change_password: mustChangePassword
            },
            token
        })
    } catch (err) {
        res.status(500).json({ message: "Error en el servidor", error: err.message })
    }
}
