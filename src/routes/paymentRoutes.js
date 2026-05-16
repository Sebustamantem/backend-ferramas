import { Router } from "express"
import { createTransaction, confirmTransaction } from "../controllers/paymentController.js"
import { verifyToken } from "../middleware/authMiddleware.js"

const router = Router()

router.post("/create", verifyToken, createTransaction)
router.get("/confirm", confirmTransaction)

export default router