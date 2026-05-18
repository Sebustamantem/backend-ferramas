import { Router } from "express"
import {
    setCredit, getMyCredit, getAllCredits,
    payWithCredit, getMyInstallments, payInstallment
} from "../controllers/ferreCreditController.js"
import { verifyToken, verifyAdmin } from "../middleware/authMiddleware.js"

const router = Router()

router.get("/my", verifyToken, getMyCredit)
router.get("/installments", verifyToken, getMyInstallments)
router.post("/pay", verifyToken, payWithCredit)
router.get("/all", verifyToken, verifyAdmin, getAllCredits)
router.post("/user/:userId", verifyToken, verifyAdmin, setCredit)
router.post("/installments/:installmentId/pay", verifyToken, verifyAdmin, payInstallment)

export default router