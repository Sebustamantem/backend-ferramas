import "dotenv/config"
import app from "./src/app.js"
import pool from "./src/config/db.js"
import { bootstrapAdmin } from "./src/config/bootstrapAdmin.js"

const PORT = process.env.PORT || 3000

const startServer = async () => {
    try {
        await pool.query("SELECT NOW()")
        console.log("Conectado a Neon PostgreSQL")

        const admin = await bootstrapAdmin()
        if (admin.created) {
            console.log("Admin inicial creado automaticamente")
            console.log(`Email: ${admin.email}`)
            console.log(`Clave temporal: ${admin.temporaryPassword}`)
            console.log("Al iniciar sesion se pedira cambiar la clave.")
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
