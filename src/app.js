import express from "express"
import cors from "cors"
import authRoutes from "./routes/authRoutes.js"
import productRoutes from "./routes/productRoutes.js"
import cartRoutes from "./routes/cartRoutes.js"
import userRoutes from "./routes/userRoutes.js"
import orderRoutes from "./routes/orderRoutes.js"
import paymentRoutes from "./routes/paymentRoutes.js"
import ferreCreditRoutes from "./routes/ferreCreditRoutes.js"
import staffRoutes from "./routes/staffRoutes.js"

const app = express()

app.use(cors({ origin: "*" }))
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
app.use("/api/staff", staffRoutes)

export default app