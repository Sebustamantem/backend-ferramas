import bcrypt from "bcryptjs"
import crypto from "crypto"
import jwt from "jsonwebtoken"
import pool from "../config/db.js"
import { ensureUsersTable } from "../config/bootstrapAdmin.js"
import { sendPasswordResetEmail, sendWelcomeEmail } from "../utils/email.js"
import { formatRut, isRutLengthValid } from "../utils/rut.js"

const normalizeRut = (rut = "") => String(rut).replace(/[^0-9kK]/g, "").toLowerCase()
const hashResetToken = (token) => crypto.createHash("sha256").update(token).digest("hex")
const PASSWORD_RESET_EXPIRES_MINUTES = 30
const PASSWORD_RESET_EXPIRES_MS = PASSWORD_RESET_EXPIRES_MINUTES * 60 * 1000

const errorResponse = (res, status, code, message, extra = {}) =>
    res.status(status).json({ code, message, ...extra })

const buildPasswordResetUrl = (token) => {
    const frontendUrl = process.env.FRONTEND_URL || process.env.CLIENT_URL || "http://localhost:5173"
    return `${frontendUrl.replace(/\/$/, "")}/recuperar-password/${token}`
}

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
        sendWelcomeEmail({
            to: user.email,
            name: user.name,
            userType: user.user_type,
        }).catch((emailErr) => console.error("Error enviando bienvenida:", emailErr.message))
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

export const forgotPassword = async (req, res) => {
    const email = String(req.body.email || "").trim().toLowerCase()

    try {
        await ensureUsersTable()

        if (!email) {
            return errorResponse(res, 400, "EMAIL_REQUIRED", "Ingresa tu correo")
        }

        const result = await pool.query(
            "SELECT id, name, email FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1",
            [email]
        )

        if (result.rows.length === 0) {
            return res.json({ message: "Si el correo existe, enviaremos instrucciones para recuperar la contraseña" })
        }

        const user = result.rows[0]
        const token = crypto.randomBytes(32).toString("hex")
        const tokenHash = hashResetToken(token)
        const expiresAt = new Date(Date.now() + PASSWORD_RESET_EXPIRES_MS)

        await pool.query(
            `UPDATE users
             SET password_reset_token=$1, password_reset_expires=$2
             WHERE id=$3`,
            [tokenHash, expiresAt, user.id]
        )

        let emailResult
        try {
            emailResult = await sendPasswordResetEmail({
                to: user.email,
                name: user.name,
                resetUrl: buildPasswordResetUrl(token),
                expiresInMinutes: PASSWORD_RESET_EXPIRES_MINUTES,
            })
        } catch (emailError) {
            console.error("Error enviando correo recuperacion:", emailError.message)
            return errorResponse(res, 502, "EMAIL_SEND_FAILED", "No se pudo enviar el correo de recuperacion", {
                error: emailError.message,
            })
        }
        console.log("Resultado correo recuperacion:", {
            to: user.email,
            sent: emailResult.sent,
            skipped: emailResult.skipped,
            reason: emailResult.reason,
        })

        res.json({ message: "Si el correo existe, enviaremos instrucciones para recuperar la contraseña" })
    } catch (err) {
        errorResponse(res, 500, "SERVER_ERROR", "Error en el servidor", { error: err.message })
    }
}

export const resetPassword = async (req, res) => {
    const { token } = req.params
    const { password } = req.body

    try {
        await ensureUsersTable()

        if (!token) {
            return errorResponse(res, 400, "RESET_TOKEN_REQUIRED", "Token invalido")
        }

        if (!password || password.length < 8) {
            return errorResponse(res, 400, "PASSWORD_TOO_SHORT", "La contraseña debe tener al menos 8 caracteres")
        }

        const tokenHash = hashResetToken(token)
        const result = await pool.query(
            `SELECT id, role, rut, password_reset_expires
             FROM users
             WHERE password_reset_token=$1
             LIMIT 1`,
            [tokenHash]
        )

        if (result.rows.length === 0) {
            return errorResponse(res, 404, "RESET_TOKEN_NOT_FOUND", "El enlace es invalido")
        }

        const user = result.rows[0]
        const expiresAt = user.password_reset_expires ? new Date(user.password_reset_expires) : null
        if (!expiresAt || expiresAt <= new Date()) {
            await pool.query(
                `UPDATE users
                 SET password_reset_token=NULL,
                     password_reset_expires=NULL
                 WHERE id=$1`,
                [user.id]
            )

            return errorResponse(res, 410, "RESET_TOKEN_EXPIRED", "El enlace expiro. Solicita uno nuevo.")
        }

        if (user.role === "admin" && normalizeRut(password) === normalizeRut(user.rut)) {
            return errorResponse(res, 400, "PASSWORD_EQUALS_RUT", "La nueva contraseña no puede ser el RUT")
        }

        const hashed = await bcrypt.hash(password, 10)
        await pool.query(
            `UPDATE users
             SET password=$1,
                 must_change_password=FALSE,
                 password_reset_token=NULL,
                 password_reset_expires=NULL
             WHERE id=$2`,
            [hashed, user.id]
        )

        res.json({ message: "Contraseña actualizada correctamente" })
    } catch (err) {
        errorResponse(res, 500, "SERVER_ERROR", "Error en el servidor", { error: err.message })
    }
}
