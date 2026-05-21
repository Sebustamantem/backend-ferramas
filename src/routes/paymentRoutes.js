import { Router } from "express"
import { createTransaction, confirmTransaction, createTransferOrder } from "../controllers/paymentController.js"
import { verifyToken } from "../middleware/authMiddleware.js"

const router = Router()

router.post("/create", verifyToken, createTransaction)
router.post("/transfer", verifyToken, createTransferOrder)
router.get("/confirm", confirmTransaction)
router.post("/confirm", confirmTransaction)

export default router
