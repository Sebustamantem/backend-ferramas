import { Router } from "express"
import { getCart, addToCart, removeFromCart } from "../controllers/cartController.js"
import { verifyToken } from "../middleware/authMiddleware.js"

const router = Router()

router.get("/", verifyToken, getCart)
router.post("/", verifyToken, addToCart)
router.delete("/:productId", verifyToken, removeFromCart)

export default router