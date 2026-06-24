import { Router } from "express"
import {
    getProducts,
    getProductById,
    createProduct,
    updateProduct,
    deleteProduct,
    getMyFavoriteProducts,
    toggleFavoriteProduct,
    getProductReviews
} from "../controllers/productController.js"
import { verifyToken, verifyAdmin } from "../middleware/authMiddleware.js"
import { upload } from "../config/cloudinary.js"

const router = Router()

router.get("/", getProducts)
router.get("/favorites/my", verifyToken, getMyFavoriteProducts)
router.get("/:id/reviews", getProductReviews)
router.get("/:id", getProductById)
router.post("/:id/favorite", verifyToken, toggleFavoriteProduct)
router.post("/", verifyToken, verifyAdmin, upload.array("images", 6), createProduct)
router.put("/:id", verifyToken, verifyAdmin, upload.array("images", 6), updateProduct)
router.delete("/:id", verifyToken, verifyAdmin, deleteProduct)

export default router
