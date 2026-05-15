import { Router } from "express"
import { getCart, addToCart, removeFromCart, clearCart } from "../controllers/cartController.js"
import { verifyToken } from "../middleware/authMiddleware.js"

const router = Router()

router.get("/", verifyToken, getCart)
router.post("/", verifyToken, addToCart)
router.delete("/clear", verifyToken, clearCart)
router.delete("/:productId", verifyToken, removeFromCart)

export default router