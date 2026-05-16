import bcrypt from "bcryptjs"
import jwt from "jsonwebtoken"
import pool from "../config/db.js"

export const register = async (req, res) => {
    const { name, lastname, email, password, rut, phone } = req.body
    try {
        const exists = await pool.query("SELECT id FROM users WHERE email = $1", [email])
        if (exists.rows.length > 0)
            return res.status(400).json({ message: "El email ya está registrado" })

        const rutExists = await pool.query("SELECT id FROM users WHERE rut = $1", [rut])
        if (rutExists.rows.length > 0)
            return res.status(400).json({ message: "El RUT ya está registrado" })

        const hashed = await bcrypt.hash(password, 10)
        const result = await pool.query(
            "INSERT INTO users (name, lastname, email, password, rut, phone, role) VALUES ($1, $2, $3, $4, $5, $6, 'cliente') RETURNING id, name, lastname, email, role",
            [name, lastname, email, hashed, rut, phone]
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
    try {
        const result = await pool.query("SELECT * FROM users WHERE email = $1", [email])
        if (result.rows.length === 0)
            return res.status(400).json({ message: "Credenciales inválidas" })

        const user = result.rows[0]
        const valid = await bcrypt.compare(password, user.password)
        if (!valid)
            return res.status(400).json({ message: "Credenciales inválidas" })

        const token = jwt.sign({ id: user.id, role: user.role }, process.env.JWT_SECRET, { expiresIn: "7d" })
        res.json({
            user: {
                id: user.id, name: user.name, lastname: user.lastname,
                email: user.email, role: user.role, phone: user.phone, rut: user.rut
            },
            token
        })
    } catch (err) {
        res.status(500).json({ message: "Error en el servidor", error: err.message })
    }
}