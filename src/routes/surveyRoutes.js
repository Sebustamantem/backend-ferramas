import { Router } from "express"
import { verifyToken, verifyAdmin } from "../middleware/authMiddleware.js"
import { getSurveySummary, submitSurvey } from "../controllers/surveyController.js"

const router = Router()

router.post("/", verifyToken, submitSurvey)
router.get("/admin", verifyToken, verifyAdmin, getSurveySummary)

export default router
