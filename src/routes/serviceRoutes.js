import { Router } from "express"
import { verifyToken } from "../middleware/authMiddleware.js"
import { createService, getMyServices, getServices, requestServiceContact } from "../controllers/serviceController.js"

const router = Router()

router.get("/", getServices)
router.get("/my", verifyToken, getMyServices)
router.post("/", verifyToken, createService)
router.post("/:serviceId/contact", verifyToken, requestServiceContact)

export default router
