import { Router } from "express"
import { getCart, addToCart, updateQuantity, removeFromCart, clearCart } from "../controllers/cartController.js"
import { verifyToken } from "../middleware/authMiddleware.js"

const router = Router()

router.get("/", verifyToken, getCart)
router.post("/", verifyToken, addToCart)
router.put("/:productId", verifyToken, updateQuantity)
router.delete("/clear", verifyToken, clearCart)
router.delete("/:productId", verifyToken, removeFromCart)

export default router