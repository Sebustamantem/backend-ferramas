import { Router } from "express"
import {
    getAllUsers, getUserById,
    updateUserRole, getMyProfile, updateMyProfile
} from "../controllers/userController.js"
import { verifyToken, verifyAdmin } from "../middleware/authMiddleware.js"

const router = Router()

router.get("/me", verifyToken, getMyProfile)
router.put("/me", verifyToken, updateMyProfile)
router.get("/", verifyToken, verifyAdmin, getAllUsers)
router.get("/:id", verifyToken, verifyAdmin, getUserById)
router.put("/:id/role", verifyToken, verifyAdmin, updateUserRole)

export default router
