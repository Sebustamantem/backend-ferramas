import { Router } from "express"
import {
    getAllUsers, getUserById,
    updateUserRole, getMyProfile, updateMyProfile, changeMyPassword
} from "../controllers/userController.js"
import { verifyToken, verifyAdmin } from "../middleware/authMiddleware.js"

const router = Router()

router.get("/me", verifyToken, getMyProfile)
router.put("/me", verifyToken, updateMyProfile)
router.put("/me/password", verifyToken, changeMyPassword)
router.get("/", verifyToken, verifyAdmin, getAllUsers)
router.get("/:id", verifyToken, verifyAdmin, getUserById)
router.put("/:id/role", verifyToken, verifyAdmin, updateUserRole)

export default router
