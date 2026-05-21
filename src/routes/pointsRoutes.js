import { Router } from "express"
import { verifyToken } from "../middleware/authMiddleware.js"
import { getMyPoints } from "../controllers/pointsController.js"

const router = Router()

router.get("/my", verifyToken, getMyPoints)

export default router
