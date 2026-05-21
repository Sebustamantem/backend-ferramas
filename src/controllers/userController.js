import pool from "../config/db.js"
import bcrypt from "bcryptjs"

export const getAllUsers = async (req, res) => {
    try {
        const result = await pool.query(
            "SELECT id, name, lastname, email, rut, phone, role, user_type, business_name, profession, created_at FROM users ORDER BY created_at DESC"
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
            "SELECT id, name, lastname, email, rut, phone, role, address, created_at FROM users WHERE id = $1",
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
    if (!["cliente", "vendedor", "bodeguero", "contador"].includes(role))
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
            "SELECT id, name, lastname, email, rut, phone, role, user_type, business_name, profession, address, created_at FROM users WHERE id = $1",
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
    const { name, lastname, email, phone, password, address, user_type, business_name, profession } = req.body
    const allowedTypes = ["cliente", "maestro", "pyme"]
    if (user_type && !allowedTypes.includes(user_type)) {
        return res.status(400).json({ message: "Tipo de usuario inválido" })
    }

    try {
        const currentResult = await pool.query(
            "SELECT user_type, business_name, profession, address FROM users WHERE id = $1",
            [req.user.id]
        )
        const current = currentResult.rows[0]
        const newType = user_type || current.user_type
        const newBusiness = business_name !== undefined ? business_name : current.business_name
        const newProfession = profession !== undefined ? profession : current.profession
        const addressValue = address !== undefined ? JSON.stringify(address) : current.address

        let query, params
        if (password) {
            const hashed = await bcrypt.hash(password, 10)
            query = "UPDATE users SET name=$1, lastname=$2, email=$3, phone=$4, password=$5, address=$6, user_type=$7, business_name=$8, profession=$9 WHERE id=$10 RETURNING id, name, lastname, email, phone, role, address, user_type, rut, business_name, profession, first_purchase_used"
            params = [name, lastname, email, phone, hashed, addressValue, newType, newBusiness, newProfession, req.user.id]
        } else {
            query = "UPDATE users SET name=$1, lastname=$2, email=$3, phone=$4, address=$5, user_type=$6, business_name=$7, profession=$8 WHERE id=$9 RETURNING id, name, lastname, email, phone, role, address, user_type, rut, business_name, profession, first_purchase_used"
            params = [name, lastname, email, phone, addressValue, newType, newBusiness, newProfession, req.user.id]
        }
        const result = await pool.query(query, params)
        res.json(result.rows[0])
    } catch (err) {
        res.status(500).json({ message: "Error al actualizar perfil", error: err.message })
    }
}
