import pkg from "pg"
import "dotenv/config"

const { Pool } = pkg

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
})

pool.on("error", (err) => {
    console.error("Error inesperado en cliente PostgreSQL:", err.message)
})

export default pool
