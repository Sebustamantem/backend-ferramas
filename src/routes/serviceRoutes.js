import { Router } from "express"
import { verifyToken } from "../middleware/authMiddleware.js"
import {
    addServiceToCart,
    createService,
    deleteService,
    getMyServices,
    getMyServiceRequests,
    getServices,
    removeServiceFromCart,
    updateService,
    updateServiceStatus,
} from "../controllers/serviceController.js"

const router = Router()

router.get("/", getServices)
router.get("/my", verifyToken, getMyServices)
router.get("/my/requests", verifyToken, getMyServiceRequests)
router.post("/", verifyToken, createService)
router.put("/:serviceId", verifyToken, updateService)
router.put("/:serviceId/status", verifyToken, updateServiceStatus)
router.delete("/:serviceId", verifyToken, deleteService)
router.post("/:serviceId/cart", verifyToken, addServiceToCart)
router.delete("/:serviceId/cart", verifyToken, removeServiceFromCart)

export default router
