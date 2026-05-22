import { Router } from "express"
import { verifyToken } from "../middleware/authMiddleware.js"
import {
    addServiceToCart,
    createService,
    getMyServices,
    getServices,
    removeServiceFromCart,
} from "../controllers/serviceController.js"

const router = Router()

router.get("/", getServices)
router.get("/my", verifyToken, getMyServices)
router.post("/", verifyToken, createService)
router.post("/:serviceId/cart", verifyToken, addServiceToCart)
router.delete("/:serviceId/cart", verifyToken, removeServiceFromCart)

export default router
