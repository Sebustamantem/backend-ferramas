import { Router } from "express"
import {
    setCredit, getMyCredit, getAllCredits,
    payWithCredit, getMyInstallments, payInstallment, getAllInstallments, rejectCreditApplication,
    requestInstallmentPayment, createInstallmentWebpayPayment, confirmInstallmentWebpayPayment
} from "../controllers/ferreCreditController.js"
import { verifyToken, verifyAdmin } from "../middleware/authMiddleware.js"

const router = Router()

router.get("/my", verifyToken, getMyCredit)
router.get("/installments", verifyToken, getMyInstallments)
router.post("/installments/:installmentId/webpay", verifyToken, createInstallmentWebpayPayment)
router.post("/installments/:installmentId/request-payment", verifyToken, requestInstallmentPayment)
router.get("/payments/confirm", confirmInstallmentWebpayPayment)
router.post("/payments/confirm", confirmInstallmentWebpayPayment)
router.post("/pay", verifyToken, payWithCredit)
router.get("/all", verifyToken, verifyAdmin, getAllCredits)
router.get("/all-installments", verifyToken, verifyAdmin, getAllInstallments)
router.post("/user/:userId", verifyToken, verifyAdmin, setCredit)
router.post("/user/:userId/reject", verifyToken, verifyAdmin, rejectCreditApplication)
router.post("/installments/:installmentId/pay", verifyToken, verifyAdmin, payInstallment)

export default router
