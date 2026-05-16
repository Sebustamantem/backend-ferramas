import { Router } from "express"
import {
    createOrder, getMyOrders, getAllOrders,
    updateOrderStatus, getOrderById
} from "../controllers/orderController.js"
import { verifyToken, verifyAdmin } from "../middleware/authMiddleware.js"

const router = Router()

router.post("/", verifyToken, createOrder)
router.get("/my", verifyToken, getMyOrders)
router.get("/all", verifyToken, verifyAdmin, getAllOrders)
router.get("/:id", verifyToken, getOrderById)
router.put("/:id/status", verifyToken, verifyAdmin, updateOrderStatus)

export default router