import { Router } from "express"
import {
    getOrders, updateOrderStatus, getClients,
    getInventory, updateStock, getOrdersForWarehouse, dispatchOrder, updateWarehouseOrderStatus
} from "../controllers/staffController.js"
import { verifyToken, verifyVendedor, verifyBodeguero } from "../middleware/authMiddleware.js"

const router = Router()

// Vendedor
router.get("/orders", verifyToken, verifyVendedor, getOrders)
router.put("/orders/:id/status", verifyToken, verifyVendedor, updateOrderStatus)
router.get("/clients", verifyToken, verifyVendedor, getClients)

// Bodeguero
router.get("/inventory", verifyToken, verifyBodeguero, getInventory)
router.put("/inventory/:id/stock", verifyToken, verifyBodeguero, updateStock)
router.get("/warehouse/orders", verifyToken, verifyBodeguero, getOrdersForWarehouse)
router.put("/warehouse/orders/:id/status", verifyToken, verifyBodeguero, updateWarehouseOrderStatus)
router.put("/warehouse/orders/:id/dispatch", verifyToken, verifyBodeguero, dispatchOrder)

export default router
