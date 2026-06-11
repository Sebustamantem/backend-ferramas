import { Router } from "express"
import { forgotPassword, login, register, resetPassword } from "../controllers/authController.js"

const router = Router()

router.post("/register", register)
router.post("/login", login)
router.post("/forgot-password", forgotPassword)
router.post("/reset-password/:token", resetPassword)

export default router
