import pool from "../config/db.js"
import bcrypt from "bcryptjs"

export const getAllUsers = async (req, res) => {
    try {
        const result = await pool.query(
            "SELECT id, name, lastname, email, rut, phone, role, created_at FROM users ORDER BY created_at DESC"
        )
        res.json(result.rows)
    } catch (err) {
        res.status(500).json({ message: "Error al obtener usuarios", error: err.message })
    }
}

export const getUserById = async (req, res) => {
    const { id } = req.params
    try {
        const result = await pool.query(
            "SELECT id, name, lastname, email, rut, phone, role, created_at FROM users WHERE id = $1",
            [id]
        )
        if (result.rows.length === 0)
            return res.status(404).json({ message: "Usuario no encontrado" })
        res.json(result.rows[0])
    } catch (err) {
        res.status(500).json({ message: "Error al obtener usuario", error: err.message })
    }
}

export const updateUser = async (req, res) => {
    const { id } = req.params
    const { name, lastname, email, phone } = req.body
    try {
        const result = await pool.query(
            "UPDATE users SET name=$1, lastname=$2, email=$3, phone=$4 WHERE id=$5 RETURNING id, name, lastname, email, phone, role",
            [name, lastname, email, phone, id]
        )
        if (result.rows.length === 0)
            return res.status(404).json({ message: "Usuario no encontrado" })
        res.json(result.rows[0])
    } catch (err) {
        res.status(500).json({ message: "Error al actualizar usuario", error: err.message })
    }
}

export const updateUserRole = async (req, res) => {
    const { id } = req.params
    const { role } = req.body
    if (!["admin", "cliente"].includes(role))
        return res.status(400).json({ message: "Rol inválido" })
    try {
        const result = await pool.query(
            "UPDATE users SET role=$1 WHERE id=$2 RETURNING id, name, email, role",
            [role, id]
        )
        if (result.rows.length === 0)
            return res.status(404).json({ message: "Usuario no encontrado" })
        res.json(result.rows[0])
    } catch (err) {
        res.status(500).json({ message: "Error al actualizar rol", error: err.message })
    }
}

export const deleteUser = async (req, res) => {
    const { id } = req.params
    try {
        await pool.query("DELETE FROM users WHERE id = $1", [id])
        res.json({ message: "Usuario eliminado correctamente" })
    } catch (err) {
        res.status(500).json({ message: "Error al eliminar usuario", error: err.message })
    }
}

export const getMyProfile = async (req, res) => {
    try {
        const result = await pool.query(
            "SELECT id, name, lastname, email, rut, phone, role, created_at FROM users WHERE id = $1",
            [req.user.id]
        )
        if (result.rows.length === 0)
            return res.status(404).json({ message: "Usuario no encontrado" })
        res.json(result.rows[0])
    } catch (err) {
        res.status(500).json({ message: "Error al obtener perfil", error: err.message })
    }
}

export const updateMyProfile = async (req, res) => {
    const { name, lastname, email, phone, password } = req.body
    try {
        let query, params
        if (password) {
            const hashed = await bcrypt.hash(password, 10)
            query = "UPDATE users SET name=$1, lastname=$2, email=$3, phone=$4, password=$5 WHERE id=$6 RETURNING id, name, lastname, email, phone, role"
            params = [name, lastname, email, phone, hashed, req.user.id]
        } else {
            query = "UPDATE users SET name=$1, lastname=$2, email=$3, phone=$4 WHERE id=$5 RETURNING id, name, lastname, email, phone, role"
            params = [name, lastname, email, phone, req.user.id]
        }
        const result = await pool.query(query, params)
        res.json(result.rows[0])
    } catch (err) {
        res.status(500).json({ message: "Error al actualizar perfil", error: err.message })
    }
}