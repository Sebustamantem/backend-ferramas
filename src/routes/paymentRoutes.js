import { Router } from "express"
import { createPreference, webhook } from "../controllers/PaymentController.js"
import { verifyToken } from "../middleware/authMiddleware.js"

const router = Router()

router.post("/create-preference", verifyToken, createPreference)
router.post("/webhook", webhook)

export default router