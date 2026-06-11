import { Router } from "express"
import {
    getAdminDashboard,
    getAdminActivity,
    cancelAdminPendingOrders,
    getAdminNotifications,
    clearAdminNotifications,
    getOrders, updateOrderStatus, getClients, getClientDetail,
    getInventory, getMyStockReports, updateStock, restockProduct, getStockMovements, reportStockIssue, getStockReports, resolveStockReport, getOrdersForWarehouse, dispatchOrder, updateWarehouseOrderStatus,
    getAccountingOrders, confirmTransferOrder, rejectTransferOrder, registerDeliveredOrder
} from "../controllers/staffController.js"
import { verifyToken, verifyAdmin, verifyVendedor, verifyBodeguero, verifyContador } from "../middleware/authMiddleware.js"

const router = Router()

// Admin
router.get("/admin/dashboard", verifyToken, verifyAdmin, getAdminDashboard)
router.get("/admin/activity", verifyToken, verifyAdmin, getAdminActivity)
router.post("/admin/pending-orders/cancel", verifyToken, verifyAdmin, cancelAdminPendingOrders)
router.get("/admin/notifications", verifyToken, verifyAdmin, getAdminNotifications)
router.post("/admin/notifications/clear", verifyToken, verifyAdmin, clearAdminNotifications)
router.get("/admin/stock-reports", verifyToken, verifyAdmin, getStockReports)
router.put("/admin/stock-reports/:id/resolve", verifyToken, verifyAdmin, resolveStockReport)

// Vendedor
router.get("/orders", verifyToken, verifyVendedor, getOrders)
router.put("/orders/:id/status", verifyToken, verifyVendedor, updateOrderStatus)
router.get("/clients", verifyToken, verifyVendedor, getClients)
router.get("/clients/:id", verifyToken, verifyVendedor, getClientDetail)

// Bodeguero
router.get("/inventory", verifyToken, verifyBodeguero, getInventory)
router.get("/inventory/reports/my", verifyToken, verifyBodeguero, getMyStockReports)
router.put("/inventory/:id/stock", verifyToken, verifyAdmin, updateStock)
router.post("/inventory/:id/restock", verifyToken, verifyAdmin, restockProduct)
router.get("/inventory/stock-movements", verifyToken, verifyAdmin, getStockMovements)
router.post("/inventory/:id/report", verifyToken, verifyBodeguero, reportStockIssue)
router.get("/warehouse/orders", verifyToken, verifyBodeguero, getOrdersForWarehouse)
router.put("/warehouse/orders/:id/status", verifyToken, verifyBodeguero, updateWarehouseOrderStatus)
router.put("/warehouse/orders/:id/dispatch", verifyToken, verifyBodeguero, dispatchOrder)

// Contador
router.get("/accounting/orders", verifyToken, verifyContador, getAccountingOrders)
router.put("/accounting/orders/:id/confirm-transfer", verifyToken, verifyContador, confirmTransferOrder)
router.put("/accounting/orders/:id/reject-transfer", verifyToken, verifyContador, rejectTransferOrder)
router.put("/accounting/orders/:id/delivered", verifyToken, verifyContador, registerDeliveredOrder)

export default router
