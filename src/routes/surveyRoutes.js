import { Router } from "express"
import { verifyToken } from "../middleware/authMiddleware.js"
import { submitSurvey } from "../controllers/surveyController.js"

const router = Router()

router.post("/", verifyToken, submitSurvey)

export default router
