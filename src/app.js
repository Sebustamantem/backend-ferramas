import express from "express";
import cors from "cors";
import authRoutes from "./routes/authRoutes.js";
import productRoutes from "./routes/productRoutes.js";
import cartRoutes from "./routes/cartRoutes.js";

const app = express();

const allowedOrigins = [
    "http://localhost:5173",
    "https://frontend-ferramas.onrender.com"
];

app.use(cors({
    origin: allowedOrigins,
    credentials: true
}));

app.use(express.json());

app.get("/", (req, res) => {
    res.json({ message: "API Ferramas funcionando correctamente" });
});

app.use("/api/auth", authRoutes);
app.use("/api/products", productRoutes);
app.use("/api/cart", cartRoutes);

export default app;