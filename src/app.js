import express from "express"
import cors from "cors"
import authRoutes from "./routes/authRoutes.js"
import productRoutes from "./routes/productRoutes.js"
import cartRoutes from "./routes/cartRoutes.js"
import userRoutes from "./routes/userRoutes.js"
import orderRoutes from "./routes/orderRoutes.js"
import paymentRoutes from "./routes/paymentRoutes.js"
import ferreCreditRoutes from "./routes/ferreCreditRoutes.js"
import pointsRoutes from "./routes/pointsRoutes.js"
import serviceRoutes from "./routes/serviceRoutes.js"
import surveyRoutes from "./routes/surveyRoutes.js"
import staffRoutes from "./routes/staffRoutes.js"

const app = express()

const allowedOrigins = [
    "http://localhost:5173",
    "http://localhost:3000",
    "https://frontend-ferremas.onrender.com",
]

app.use((req, res, next) => {
    const origin = req.headers.origin
    const allowedOrigin = allowedOrigins.includes(origin) ? origin : "*"

    res.setHeader("Access-Control-Allow-Origin", allowedOrigin)
    res.setHeader("Vary", "Origin")
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS")
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization")

    if (req.method === "OPTIONS") {
        return res.sendStatus(204)
    }

    next()
})

app.use(cors({ origin: allowedOrigins, credentials: false }))
app.use(express.json())

app.get("/", (req, res) => {
    res.json({ message: "API Ferremas funcionando correctamente" })
})

app.use("/api/auth", authRoutes)
app.use("/api/products", productRoutes)
app.use("/api/cart", cartRoutes)
app.use("/api/users", userRoutes)
app.use("/api/orders", orderRoutes)
app.use("/api/payment", paymentRoutes)
app.use("/api/ferre-credit", ferreCreditRoutes)
app.use("/api/points", pointsRoutes)
app.use("/api/services", serviceRoutes)
app.use("/api/surveys", surveyRoutes)
app.use("/api/staff", staffRoutes)

app.use((err, req, res, next) => {
    console.error("Unhandled API error:", err)
    res.status(err.status || 500).json({
        message: "Error interno del servidor",
        error: err.message,
    })
})

export default app
