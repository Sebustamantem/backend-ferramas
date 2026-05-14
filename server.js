import "dotenv/config";
import app from "./src/app.js";
import pool from "./src/config/db.js";

const PORT = process.env.PORT || 3000;

// conexión a la base de datos
pool.query("SELECT NOW()")
    .then(() => console.log("Conectado a Neon PostgreSQL"))
    .catch((err) => console.error("Error conectando a la BD:", err.message));

app.listen(PORT, () => {
    console.log(`Servidor corriendo en puerto ${PORT}`);
});