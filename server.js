import "dotenv/config"
import app from "./src/app.js"
import pool from "./src/config/db.js"
import { bootstrapAdmin, ensureCommerceTables } from "./src/config/bootstrapAdmin.js"

const PORT = process.env.PORT || 3000

const startServer = async () => {
    try {
        await pool.query("SELECT NOW()")
        console.log("Conectado a Neon PostgreSQL")

        const admin = await bootstrapAdmin()
        await ensureCommerceTables()
        if (admin.created) {
            console.log("Admin inicial creado automaticamente")
            console.log(`Email: ${admin.email}`)
            console.log(`Clave temporal: ${admin.temporaryPassword}`)
            console.log("Al iniciar sesion se pedira cambiar la clave.")
        } else if (admin.reset) {
            console.log("Clave temporal de admin regenerada")
            console.log(`Email: ${admin.email}`)
            console.log(`Clave temporal: ${admin.temporaryPassword}`)
            console.log("Al iniciar sesion se pedira cambiar la clave.")
        } else {
            console.log(`Admin existente detectado: ${admin.email}`)
            if (admin.passwordAlreadyChanged) {
                console.log("El admin ya cambio su clave. No se regenera ni se vuelve a pedir cambio.")
            } else {
                console.log("Admin pendiente de cambio de clave. No se regenera automaticamente en deploys.")
            }
            console.log("Usa FORCE_RESET_BOOTSTRAP_ADMIN_PASSWORD=true solo si necesitas forzar un reinicio de clave.")
        }

        app.listen(PORT, () => {
            console.log(`Servidor corriendo en puerto ${PORT}`)
        })
    } catch (err) {
        console.error("Error iniciando el servidor:", err.message)
        process.exit(1)
    }
}

startServer()
