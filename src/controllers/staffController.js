import pool from "../config/db.js"
import { ensureCommerceTables } from "../config/bootstrapAdmin.js"
import { addPointsForOrder, ensurePointsTables, restoreUsedPointsForOrder } from "./pointsController.js"
import { cancelServiceRequestsForOrder, ensureServiceTables, markServiceRequestsPaid } from "./serviceController.js"
import { ensureSurveyTable } from "./surveyController.js"
import { ensureActivityLogTable, getActivityLogs, getRecentActivityLogs, logActivity } from "../utils/activityLog.js"
import { cancelExpiredPendingOrders } from "../utils/pendingOrders.js"
import { sendOrderStatusEmail } from "../utils/email.js"

const getDisplayName = (user = {}) => [user.name, user.lastname].filter(Boolean).join(" ").trim() || user.email

const notifyOrderStatus = async (orderId, status) => {
    const result = await pool.query(
        `SELECT o.id, o.total, o.status, o.delivery_method, o.created_at,
                u.name, u.lastname, u.email
         FROM orders o
         LEFT JOIN users u ON u.id = o.user_id
         WHERE o.id=$1`,
        [orderId]
    )
    const row = result.rows[0]
    if (!row?.email) return

    await sendOrderStatusEmail({
        to: row.email,
        name: getDisplayName(row),
        order: row,
        status,
    })
}

const ensureStockReportsTable = async () => {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS stock_reports (
            id SERIAL PRIMARY KEY,
            product_id INTEGER REFERENCES products(id) ON DELETE CASCADE,
            reported_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
            current_stock INTEGER NOT NULL DEFAULT 0,
            reason TEXT NOT NULL DEFAULT '',
            status VARCHAR(30) NOT NULL DEFAULT 'pending',
            resolved_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
            resolved_at TIMESTAMP,
            created_at TIMESTAMP DEFAULT NOW()
        )
    `)
}

const ensureStockMovementsTable = async () => {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS stock_movements (
            id SERIAL PRIMARY KEY,
            product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
            user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
            movement_type VARCHAR(30) NOT NULL DEFAULT 'restock',
            quantity INTEGER NOT NULL,
            previous_stock INTEGER NOT NULL DEFAULT 0,
            new_stock INTEGER NOT NULL DEFAULT 0,
            reason TEXT,
            created_at TIMESTAMP DEFAULT NOW()
        )
    `)
}

const ensureAdminNotificationDismissalsTable = async () => {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS admin_notification_dismissals (
            id SERIAL PRIMARY KEY,
            user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
            notification_type VARCHAR(80) NOT NULL,
            reference_id VARCHAR(120) NOT NULL,
            created_at TIMESTAMP DEFAULT NOW(),
            UNIQUE(user_id, notification_type, reference_id)
        )
    `)
}

const getDismissedNotificationKeys = async (userId) => {
    await ensureAdminNotificationDismissalsTable()
    const result = await pool.query(
        `SELECT notification_type, reference_id
         FROM admin_notification_dismissals
         WHERE user_id=$1`,
        [userId]
    )
    return new Set(result.rows.map((row) => `${row.notification_type}:${row.reference_id}`))
}

const isNotificationDismissed = (dismissed, type, referenceId) =>
    dismissed.has(`${type}:${String(referenceId)}`)

export const getAdminDashboard = async (req, res) => {
    try {
        await ensureCommerceTables()
        await ensureSurveyTable()
        await ensureServiceTables()
        await ensureStockReportsTable()
        await ensureActivityLogTable()
        await cancelExpiredPendingOrders()

        const [
            salesToday,
            pendingOrders,
            transferPending,
            outOfStock,
            pendingStockReports,
            pendingCreditApplications,
            newUsers,
            services,
            surveySummary,
            recentSurveys,
            recentOrders,
            recentActivity,
            salesLast7Days,
            ordersByStatus,
            topProducts,
            agedTransferPending,
            agedPaidOrders,
            overdueInstallments,
        ] = await Promise.all([
            pool.query(
                `SELECT COALESCE(SUM(total), 0) as total, COUNT(*)::int as count
                 FROM orders
                 WHERE status IN ('paid', 'processing', 'shipped', 'delivered')
                   AND created_at::date = CURRENT_DATE`
            ),
            pool.query(
                `SELECT COUNT(*)::int as count
                 FROM orders
                 WHERE status IN ('pending', 'transfer_pending', 'paid')`
            ),
            pool.query("SELECT COUNT(*)::int as count FROM orders WHERE status='transfer_pending'"),
            pool.query("SELECT COUNT(*)::int as count FROM products WHERE stock <= 0"),
            pool.query("SELECT COUNT(*)::int as count FROM stock_reports WHERE status='pending'"),
            pool.query(
                `SELECT COUNT(*)::int as count
                 FROM users
                 WHERE user_type IN ('maestro_pending', 'pyme_pending')`
            ),
            pool.query(
                `SELECT COUNT(*)::int as count
                 FROM users
                 WHERE created_at >= NOW() - INTERVAL '7 days'`
            ),
            pool.query(
                `SELECT
                    COUNT(*)::int as total,
                    COUNT(*) FILTER (WHERE is_active = TRUE)::int as active
                 FROM professional_services`
            ),
            pool.query(
                `SELECT
                    COUNT(*)::int as total,
                    COALESCE(ROUND(AVG(rating)::numeric, 1), 0) as average_rating
                 FROM satisfaction_surveys`
            ),
            pool.query(
                `SELECT ss.id, ss.order_id, ss.rating, ss.comment, ss.created_at,
                        u.name as user_name, u.lastname as user_lastname, u.email as user_email
                 FROM satisfaction_surveys ss
                 LEFT JOIN users u ON ss.user_id = u.id
                 ORDER BY ss.created_at DESC
                 LIMIT 8`
            ),
            pool.query(
                `SELECT o.id, o.total, o.status, o.created_at,
                        u.name as user_name, u.lastname as user_lastname, u.email as user_email
                 FROM orders o
                 LEFT JOIN users u ON o.user_id = u.id
                 ORDER BY o.created_at DESC
                 LIMIT 6`
            ),
            getRecentActivityLogs(10),
            pool.query(
                `SELECT day::date,
                        COALESCE(SUM(o.total), 0) as total,
                        COUNT(o.id)::int as count
                 FROM generate_series(CURRENT_DATE - INTERVAL '6 days', CURRENT_DATE, INTERVAL '1 day') day
                 LEFT JOIN orders o
                   ON o.created_at::date = day::date
                  AND o.status IN ('paid', 'processing', 'shipped', 'delivered')
                 GROUP BY day
                 ORDER BY day ASC`
            ),
            pool.query(
                `SELECT status, COUNT(*)::int as count
                 FROM orders
                 GROUP BY status
                 ORDER BY count DESC`
            ),
            pool.query(
                `SELECT p.id, p.name, COALESCE(SUM(oi.quantity), 0)::int as quantity,
                        COALESCE(SUM(oi.quantity * oi.price), 0) as total
                 FROM order_items oi
                 LEFT JOIN products p ON p.id = oi.product_id
                 GROUP BY p.id, p.name
                 ORDER BY quantity DESC, total DESC
                 LIMIT 8`
            ),
            pool.query(
                `SELECT COUNT(*)::int as count
                 FROM orders
                 WHERE status='transfer_pending'
                   AND created_at < NOW() - INTERVAL '24 hours'`
            ),
            pool.query(
                `SELECT COUNT(*)::int as count
                 FROM orders
                 WHERE status='paid'
                   AND created_at < NOW() - INTERVAL '24 hours'`
            ),
            pool.query(
                `SELECT COUNT(*)::int as count
                 FROM ferre_credit_installments
                 WHERE paid_installments < installments
                   AND (
                    status IN ('overdue', 'late', 'delinquent')
                    OR (status='active' AND due_date IS NOT NULL AND due_date < NOW())
                   )`
            ),
        ])

        res.json({
            message: "Dashboard admin obtenido correctamente",
            sales_today: {
                total: Number(salesToday.rows[0]?.total || 0),
                count: Number(salesToday.rows[0]?.count || 0),
            },
            pending_orders: Number(pendingOrders.rows[0]?.count || 0),
            transfer_pending: Number(transferPending.rows[0]?.count || 0),
            out_of_stock: Number(outOfStock.rows[0]?.count || 0),
            pending_stock_reports: Number(pendingStockReports.rows[0]?.count || 0),
            pending_credit_applications: Number(pendingCreditApplications.rows[0]?.count || 0),
            new_users_7d: Number(newUsers.rows[0]?.count || 0),
            services: {
                total: Number(services.rows[0]?.total || 0),
                active: Number(services.rows[0]?.active || 0),
            },
            surveys: {
                total: Number(surveySummary.rows[0]?.total || 0),
                average_rating: Number(surveySummary.rows[0]?.average_rating || 0),
                comments: recentSurveys.rows,
            },
            recent_orders: recentOrders.rows,
            recent_activity: recentActivity,
            charts: {
                sales_last_7_days: salesLast7Days.rows.map((row) => ({
                    date: row.day,
                    total: Number(row.total || 0),
                    count: Number(row.count || 0),
                })),
                orders_by_status: ordersByStatus.rows.map((row) => ({
                    status: row.status,
                    count: Number(row.count || 0),
                })),
                top_products: topProducts.rows.map((row) => ({
                    id: row.id,
                    name: row.name || "Producto eliminado",
                    quantity: Number(row.quantity || 0),
                    total: Number(row.total || 0),
                })),
            },
            alerts: {
                aged_transfer_pending: Number(agedTransferPending.rows[0]?.count || 0),
                aged_paid_orders: Number(agedPaidOrders.rows[0]?.count || 0),
                overdue_installments: Number(overdueInstallments.rows[0]?.count || 0),
            },
        })
    } catch (err) {
        res.status(500).json({ message: "Error al obtener dashboard admin", error: err.message })
    }
}

export const getAdminActivity = async (req, res) => {
    try {
        const logs = await getActivityLogs({
            action: req.query.action || "",
            entityType: req.query.entity_type || "",
            userId: req.query.user_id || "",
            dateFrom: req.query.date_from || "",
            dateTo: req.query.date_to || "",
            limit: req.query.limit || 120,
        })
        res.json({
            message: "Historial obtenido correctamente",
            activity: logs,
        })
    } catch (err) {
        res.status(500).json({ message: "Error al obtener historial", error: err.message })
    }
}

export const cancelAdminPendingOrders = async (req, res) => {
    try {
        const result = await cancelExpiredPendingOrders({ force: true })
        res.json({
            message: `${result.cancelled} pedidos pendientes cancelados`,
            ...result,
        })
    } catch (err) {
        res.status(500).json({ message: "Error al cancelar pedidos pendientes", error: err.message })
    }
}

export const getAdminNotifications = async (req, res) => {
    try {
        await ensureCommerceTables()
        await ensureStockReportsTable()
        const dismissed = await getDismissedNotificationKeys(req.user.id)

        const [stockReports, creditApplications, pendingOrders, transferPending, outOfStock] = await Promise.all([
            pool.query(
                `SELECT sr.id, sr.product_id, sr.reason, sr.created_at, p.name as product_name
                 FROM stock_reports sr
                 JOIN products p ON p.id = sr.product_id
                 WHERE sr.status='pending'
                 ORDER BY sr.created_at DESC
                 LIMIT 80`
            ),
            pool.query(
                `SELECT id, name, lastname, email, user_type, created_at
                 FROM users
                 WHERE user_type IN ('maestro_pending', 'pyme_pending')
                 ORDER BY created_at DESC
                 LIMIT 80`
            ),
            pool.query(
                `SELECT id, total, status, created_at
                 FROM orders
                 WHERE status IN ('pending', 'paid')
                 ORDER BY created_at DESC
                 LIMIT 80`
            ),
            pool.query("SELECT COUNT(*)::int as count FROM orders WHERE status='transfer_pending'"),
            pool.query("SELECT COUNT(*)::int as count FROM products WHERE stock <= 0"),
        ])

        const stockReportRows = stockReports.rows.filter((report) =>
            !isNotificationDismissed(dismissed, "stock_report", report.id)
        )
        const creditApplicationRows = creditApplications.rows.filter((application) =>
            !isNotificationDismissed(dismissed, "credit_application", application.id)
        )
        const pendingOrderRows = pendingOrders.rows.filter((order) =>
            !isNotificationDismissed(dismissed, "pending_order", order.id)
        )
        const transferPendingCount = Number(transferPending.rows[0]?.count || 0)
        const outOfStockCount = Number(outOfStock.rows[0]?.count || 0)
        const visibleTransferPending = isNotificationDismissed(dismissed, "transfer_pending", `count:${transferPendingCount}`)
            ? 0
            : transferPendingCount
        const visibleOutOfStock = isNotificationDismissed(dismissed, "out_of_stock", `count:${outOfStockCount}`)
            ? 0
            : outOfStockCount

        const items = [
            ...stockReportRows.map((report) => ({
                type: "stock_report",
                reference_id: String(report.id),
                label: "Reporte de bodega",
                text: report.product_name,
                target: "/admin/products",
                created_at: report.created_at,
            })),
            ...creditApplicationRows.map((application) => ({
                type: "credit_application",
                reference_id: String(application.id),
                label: "Postulacion FerreCredito",
                text: `${application.name || ""} ${application.lastname || ""}`.trim() || application.email,
                target: "/admin/credits",
                created_at: application.created_at,
            })),
            ...pendingOrderRows.map((order) => ({
                type: "pending_order",
                reference_id: String(order.id),
                label: "Pedido pendiente",
                text: `Pedido #${order.id}`,
                target: "/admin/dashboard",
                created_at: order.created_at,
            })),
        ].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 12)

        const counts = {
            stock_reports: stockReportRows.length,
            credit_applications: creditApplicationRows.length,
            pending_orders: pendingOrderRows.length,
            transfer_pending: visibleTransferPending,
            out_of_stock: visibleOutOfStock,
        }

        res.json({
            message: "Notificaciones obtenidas correctamente",
            counts,
            total: Object.values(counts).reduce((acc, value) => acc + Number(value || 0), 0),
            items,
        })
    } catch (err) {
        res.status(500).json({ message: "Error al obtener notificaciones", error: err.message })
    }
}

export const clearAdminNotifications = async (req, res) => {
    try {
        await ensureCommerceTables()
        await ensureStockReportsTable()
        await ensureAdminNotificationDismissalsTable()

        const [stockReports, creditApplications, pendingOrders, transferPending, outOfStock] = await Promise.all([
            pool.query("SELECT id FROM stock_reports WHERE status='pending'"),
            pool.query("SELECT id FROM users WHERE user_type IN ('maestro_pending', 'pyme_pending')"),
            pool.query("SELECT id FROM orders WHERE status IN ('pending', 'paid')"),
            pool.query("SELECT COUNT(*)::int as count FROM orders WHERE status='transfer_pending'"),
            pool.query("SELECT COUNT(*)::int as count FROM products WHERE stock <= 0"),
        ])

        const dismissals = [
            ...stockReports.rows.map((row) => ({ type: "stock_report", referenceId: String(row.id) })),
            ...creditApplications.rows.map((row) => ({ type: "credit_application", referenceId: String(row.id) })),
            ...pendingOrders.rows.map((row) => ({ type: "pending_order", referenceId: String(row.id) })),
        ]
        const transferPendingCount = Number(transferPending.rows[0]?.count || 0)
        const outOfStockCount = Number(outOfStock.rows[0]?.count || 0)

        if (transferPendingCount > 0) {
            dismissals.push({ type: "transfer_pending", referenceId: `count:${transferPendingCount}` })
        }
        if (outOfStockCount > 0) {
            dismissals.push({ type: "out_of_stock", referenceId: `count:${outOfStockCount}` })
        }

        for (const dismissal of dismissals) {
            await pool.query(
                `INSERT INTO admin_notification_dismissals (user_id, notification_type, reference_id)
                 VALUES ($1, $2, $3)
                 ON CONFLICT (user_id, notification_type, reference_id) DO NOTHING`,
                [req.user.id, dismissal.type, dismissal.referenceId]
            )
        }

        res.json({
            message: "Notificaciones vaciadas",
            cleared: dismissals.length,
        })
    } catch (err) {
        res.status(500).json({ message: "Error al vaciar notificaciones", error: err.message })
    }
}

// ===== VENDEDOR =====

export const getOrders = async (req, res) => {
    try {
        await cancelExpiredPendingOrders()
        const orders = await pool.query(
            `SELECT o.*, u.name as user_name, u.email as user_email, u.phone as user_phone,
        COALESCE(json_agg(json_build_object(
          'product_id', oi.product_id,
          'name', p.name,
          'quantity', oi.quantity,
          'price', oi.price,
          'image_url', p.image_url
        )) FILTER (WHERE oi.id IS NOT NULL), '[]') as items
       FROM orders o
       JOIN users u ON o.user_id = u.id
       LEFT JOIN order_items oi ON o.id = oi.order_id
       LEFT JOIN products p ON oi.product_id = p.id
       GROUP BY o.id, u.name, u.email, u.phone
       ORDER BY o.created_at DESC`
        )
        res.json({
            message: "Pedidos obtenidos correctamente",
            orders: orders.rows,
        })
    } catch (err) {
        res.status(500).json({ message: "Error al obtener pedidos", error: err.message })
    }
}

export const updateOrderStatus = async (req, res) => {
    const { id } = req.params
    const { status } = req.body
    const validStatuses = ["pending", "transfer_pending", "paid", "processing", "shipped", "delivered", "cancelled"]
    if (!validStatuses.includes(status))
        return res.status(400).json({ message: "Estado inválido" })
    try {
        const result = await pool.query(
            "UPDATE orders SET status=$1 WHERE id=$2 RETURNING *",
            [status, id]
        )
        if (result.rows.length === 0)
            return res.status(404).json({ message: "Orden no encontrada" })
        notifyOrderStatus(result.rows[0].id, status)
            .catch((emailErr) => console.error("Error enviando estado de pedido:", emailErr.message))
        res.json({
            message: "Estado del pedido actualizado correctamente",
            order: result.rows[0],
        })
    } catch (err) {
        res.status(500).json({ message: "Error al actualizar estado", error: err.message })
    }
}

export const getClients = async (req, res) => {
    try {
        await ensureCommerceTables()
        await ensurePointsTables()
        const result = await pool.query(
            `SELECT u.id, u.name, u.lastname, u.email, u.rut, u.phone, u.user_type, u.address, u.created_at,
                    COALESCE(COUNT(o.id), 0)::int as order_count,
                    COALESCE(SUM(CASE WHEN o.status <> 'cancelled' THEN o.total ELSE 0 END), 0) as total_spent,
                    COALESCE(up.balance, 0)::int as points_balance,
                    fc.credit_limit,
                    fc.balance_used,
                    fc.is_active as credit_active
             FROM users u
             LEFT JOIN orders o ON o.user_id = u.id
             LEFT JOIN user_points up ON up.user_id = u.id
             LEFT JOIN ferre_credits fc ON fc.user_id = u.id
             WHERE u.role NOT IN ('admin', 'vendedor', 'bodeguero', 'contador')
             GROUP BY u.id, up.balance, fc.credit_limit, fc.balance_used, fc.is_active
             ORDER BY u.created_at DESC`
        )
        res.json({
            message: "Clientes obtenidos correctamente",
            clients: result.rows,
        })
    } catch (err) {
        res.status(500).json({ message: "Error al obtener clientes", error: err.message })
    }
}

export const getClientDetail = async (req, res) => {
    const { id } = req.params
    try {
        await ensureCommerceTables()
        await ensurePointsTables()
        await ensureActivityLogTable()
        const [client, orders, points, pointTransactions, credit, installments, activity] = await Promise.all([
            pool.query(
                `SELECT id, name, lastname, email, rut, phone, user_type, business_name, profession, address, created_at
                 FROM users
                 WHERE id=$1 AND role NOT IN ('admin', 'vendedor', 'bodeguero', 'contador')`,
                [id]
            ),
            pool.query(
                `SELECT o.*,
                        COALESCE(json_agg(json_build_object(
                            'product_id', oi.product_id,
                            'name', p.name,
                            'quantity', oi.quantity,
                            'price', oi.price,
                            'image_url', p.image_url
                        )) FILTER (WHERE oi.id IS NOT NULL), '[]') as items
                 FROM orders o
                 LEFT JOIN order_items oi ON o.id = oi.order_id
                 LEFT JOIN products p ON oi.product_id = p.id
                 WHERE o.user_id=$1
                 GROUP BY o.id
                 ORDER BY o.created_at DESC
                 LIMIT 12`,
                [id]
            ),
            pool.query("SELECT COALESCE(balance, 0)::int as balance FROM user_points WHERE user_id=$1", [id]),
            pool.query(
                `SELECT id, order_id, type, points, description, created_at
                 FROM point_transactions
                 WHERE user_id=$1
                 ORDER BY created_at DESC
                 LIMIT 10`,
                [id]
            ),
            pool.query("SELECT * FROM ferre_credits WHERE user_id=$1", [id]),
            pool.query(
                `SELECT id, order_id, total_amount, installments, amount_per_installment,
                        paid_installments, status, due_date, created_at
                 FROM ferre_credit_installments
                 WHERE user_id=$1
                 ORDER BY created_at DESC
                 LIMIT 10`,
                [id]
            ),
            pool.query(
                `SELECT al.*, u.name as user_name, u.lastname as user_lastname, u.role as user_role
                 FROM activity_logs al
                 LEFT JOIN users u ON u.id = al.user_id
                 WHERE al.user_id=$1
                 ORDER BY al.created_at DESC
                 LIMIT 10`,
                [id]
            ),
        ])

        if (client.rows.length === 0) {
            return res.status(404).json({ message: "Cliente no encontrado" })
        }

        res.json({
            message: "Ficha de cliente obtenida correctamente",
            client: client.rows[0],
            orders: orders.rows,
            points: {
                balance: Number(points.rows[0]?.balance || 0),
                transactions: pointTransactions.rows,
            },
            ferre_credit: credit.rows[0] || null,
            ferre_credit_installments: installments.rows,
            activity: activity.rows,
        })
    } catch (err) {
        res.status(500).json({ message: "Error al obtener ficha de cliente", error: err.message })
    }
}

// ===== BODEGUERO =====

export const getInventory = async (req, res) => {
    try {
        const result = await pool.query(
            "SELECT * FROM products ORDER BY stock ASC"
        )
        res.json({
            message: "Inventario obtenido correctamente",
            inventory: result.rows,
        })
    } catch (err) {
        res.status(500).json({ message: "Error al obtener inventario", error: err.message })
    }
}

export const getMyStockReports = async (req, res) => {
    try {
        await ensureStockReportsTable()
        const isAdmin = req.user.role === "admin"
        const result = await pool.query(
            `SELECT sr.id, sr.product_id, sr.reason, sr.status, sr.created_at,
                    p.name as product_name, p.stock
             FROM stock_reports sr
             JOIN products p ON p.id = sr.product_id
             WHERE sr.status='pending'
               AND ($1::boolean = TRUE OR sr.reported_by=$2)
             ORDER BY sr.created_at DESC`,
            [isAdmin, req.user.id]
        )
        res.json({
            message: "Inventario obtenido correctamente",
            inventory: result.rows,
        })
    } catch (err) {
        res.status(500).json({ message: "Error al obtener tus avisos de stock", error: err.message })
    }
}

export const reportStockIssue = async (req, res) => {
    const { id } = req.params
    const { reason = "Producto no disponible" } = req.body

    try {
        await ensureStockReportsTable()
        const product = await pool.query("SELECT id, stock FROM products WHERE id=$1", [id])
        if (product.rows.length === 0) {
            return res.status(404).json({ message: "Producto no encontrado" })
        }
        if (Number(product.rows[0].stock || 0) > 0) {
            return res.status(400).json({ message: "Solo se puede informar al admin productos sin stock" })
        }

        const existing = await pool.query(
            `SELECT id
             FROM stock_reports
             WHERE product_id=$1 AND status='pending'
             LIMIT 1`,
            [id]
        )
        if (existing.rows.length > 0) {
            return res.status(409).json({ message: "Este producto ya tiene un aviso pendiente para admin" })
        }

        const result = await pool.query(
            `INSERT INTO stock_reports (product_id, reported_by, current_stock, reason)
             VALUES ($1, $2, $3, $4)
             RETURNING *`,
            [id, req.user.id, Number(product.rows[0].stock || 0), reason.trim() || "Producto no disponible"]
        )
        await logActivity({
            userId: req.user.id,
            action: "stock_reported",
            entityType: "product",
            entityId: Number(id),
            description: "Bodega informo producto sin stock",
            metadata: { reason: reason.trim() || "Producto no disponible" },
        }).catch((logErr) => console.error("Error registrando actividad:", logErr.message))
        res.status(201).json({
            message: "Aviso de stock informado correctamente",
            report: result.rows[0],
        })
    } catch (err) {
        res.status(500).json({ message: "Error al informar stock", error: err.message })
    }
}

export const getStockReports = async (req, res) => {
    try {
        await ensureStockReportsTable()
        const result = await pool.query(
            `SELECT sr.*, p.name as product_name, p.category, p.price, p.stock,
                    u.name as reporter_name, u.lastname as reporter_lastname, u.email as reporter_email
             FROM stock_reports sr
             JOIN products p ON p.id = sr.product_id
             LEFT JOIN users u ON u.id = sr.reported_by
             ORDER BY sr.status='pending' DESC, sr.created_at DESC`
        )
        res.json({
            message: "Avisos de stock obtenidos correctamente",
            reports: result.rows,
        })
    } catch (err) {
        res.status(500).json({ message: "Error al obtener avisos de stock", error: err.message })
    }
}

export const resolveStockReport = async (req, res) => {
    const { id } = req.params
    try {
        await ensureStockReportsTable()
        const result = await pool.query(
            `UPDATE stock_reports
             SET status='resolved', resolved_by=$1, resolved_at=NOW()
             WHERE id=$2
             RETURNING *`,
            [req.user.id, id]
        )
        if (result.rows.length === 0) {
            return res.status(404).json({ message: "Aviso no encontrado" })
        }
        await logActivity({
            userId: req.user.id,
            action: "stock_report_resolved",
            entityType: "stock_report",
            entityId: Number(id),
            description: "Admin marco un reporte de bodega como resuelto",
        }).catch((logErr) => console.error("Error registrando actividad:", logErr.message))
        res.json({
            message: "Aviso de stock resuelto correctamente",
            report: result.rows[0],
        })
    } catch (err) {
        res.status(500).json({ message: "Error al resolver aviso", error: err.message })
    }
}

export const updateStock = async (req, res) => {
    const { id } = req.params
    const { stock, reason } = req.body
    try {
        const result = await pool.query(
            "UPDATE products SET stock=$1 WHERE id=$2 RETURNING *",
            [stock, id]
        )
        if (result.rows.length === 0)
            return res.status(404).json({ message: "Producto no encontrado" })
        await logActivity({
            userId: req.user.id,
            action: "stock_updated",
            entityType: "product",
            entityId: Number(id),
            description: reason || "Admin actualizo stock",
            metadata: { stock: Number(stock) },
        }).catch((logErr) => console.error("Error registrando actividad:", logErr.message))
        res.json({
            message: "Stock actualizado correctamente",
            product: result.rows[0],
        })
    } catch (err) {
        res.status(500).json({ message: "Error al actualizar stock", error: err.message })
    }
}

export const restockProduct = async (req, res) => {
    const { id } = req.params
    const quantity = Math.floor(Number(req.body.quantity || 0))
    const reason = (req.body.reason || "Reposicion de inventario").trim()

    if (!Number.isFinite(quantity) || quantity <= 0) {
        return res.status(400).json({ message: "La cantidad de reposicion debe ser mayor a 0" })
    }

    const client = await pool.connect()
    try {
        await ensureStockReportsTable()
        await ensureStockMovementsTable()
        await client.query("BEGIN")

        const product = await client.query("SELECT id, name, stock FROM products WHERE id=$1 FOR UPDATE", [id])
        if (product.rows.length === 0) {
            await client.query("ROLLBACK")
            return res.status(404).json({ message: "Producto no encontrado" })
        }

        const previousStock = Number(product.rows[0].stock || 0)
        const newStock = previousStock + quantity
        const updated = await client.query(
            "UPDATE products SET stock=$1 WHERE id=$2 RETURNING *",
            [newStock, id]
        )
        const movement = await client.query(
            `INSERT INTO stock_movements (
                product_id, user_id, movement_type, quantity, previous_stock, new_stock, reason
             )
             VALUES ($1, $2, 'restock', $3, $4, $5, $6)
             RETURNING *`,
            [id, req.user.id, quantity, previousStock, newStock, reason || "Reposicion de inventario"]
        )

        await client.query(
            `UPDATE stock_reports
             SET status='resolved', resolved_by=$1, resolved_at=NOW()
             WHERE product_id=$2 AND status='pending'`,
            [req.user.id, id]
        )

        await client.query("COMMIT")
        await logActivity({
            userId: req.user.id,
            action: "stock_restocked",
            entityType: "product",
            entityId: Number(id),
            description: `Admin repuso ${quantity} unidades de ${product.rows[0].name}`,
            metadata: { previous_stock: previousStock, new_stock: newStock, reason },
        }).catch((logErr) => console.error("Error registrando actividad:", logErr.message))

        res.json({
            message: "Stock repuesto correctamente",
            product: updated.rows[0],
            movement: movement.rows[0],
        })
    } catch (err) {
        await client.query("ROLLBACK")
        res.status(500).json({ message: "Error al reponer stock", error: err.message })
    } finally {
        client.release()
    }
}

export const getStockMovements = async (req, res) => {
    try {
        await ensureStockMovementsTable()
        const result = await pool.query(
            `SELECT sm.*, p.name as product_name, u.name as user_name, u.lastname as user_lastname, u.role as user_role
             FROM stock_movements sm
             LEFT JOIN products p ON p.id = sm.product_id
             LEFT JOIN users u ON u.id = sm.user_id
             ORDER BY sm.created_at DESC
             LIMIT 120`
        )
        res.json({
            message: "Historial de stock obtenido correctamente",
            movements: result.rows,
        })
    } catch (err) {
        res.status(500).json({ message: "Error al obtener historial de stock", error: err.message })
    }
}

export const getOrdersForWarehouse = async (req, res) => {
    try {
        const orders = await pool.query(
            `SELECT o.*, u.name as user_name, u.email as user_email,
        COALESCE(json_agg(json_build_object(
          'product_id', oi.product_id,
          'name', p.name,
          'quantity', oi.quantity,
          'price', oi.price,
          'image_url', p.image_url
        )) FILTER (WHERE oi.id IS NOT NULL), '[]') as items
       FROM orders o
       JOIN users u ON o.user_id = u.id
       LEFT JOIN order_items oi ON o.id = oi.order_id
       LEFT JOIN products p ON oi.product_id = p.id
       WHERE o.status IN ('paid', 'processing', 'shipped', 'delivered')
       GROUP BY o.id, u.name, u.email
       ORDER BY o.created_at DESC`
        )
        res.json({
            message: "Pedidos de bodega obtenidos correctamente",
            orders: orders.rows,
        })
    } catch (err) {
        res.status(500).json({ message: "Error al obtener pedidos", error: err.message })
    }
}

export const dispatchOrder = async (req, res) => {
    const { id } = req.params
    try {
        const result = await pool.query(
            "UPDATE orders SET status='shipped' WHERE id=$1 AND status='processing' RETURNING *",
            [id]
        )
        if (result.rows.length === 0)
            return res.status(400).json({ message: "El pedido no está en estado processing" })
        notifyOrderStatus(result.rows[0].id, "shipped")
            .catch((emailErr) => console.error("Error enviando despacho:", emailErr.message))
        res.json({
            message: "Pedido despachado correctamente",
            order: result.rows[0],
        })
    } catch (err) {
        res.status(500).json({ message: "Error al despachar pedido", error: err.message })
    }
}

export const updateWarehouseOrderStatus = async (req, res) => {
    const { id } = req.params
    const { status } = req.body
    const validStatuses = ["processing", "shipped", "delivered"]
    if (!validStatuses.includes(status))
        return res.status(400).json({ message: "Estado invalido para bodega" })

    try {
        const result = await pool.query(
            `UPDATE orders
             SET status=$1
             WHERE id=$2
               AND (
                (status='paid' AND $1='processing')
                OR (status='processing' AND $1='shipped')
                OR (status='shipped' AND $1='delivered')
               )
             RETURNING *`,
            [status, id]
        )
        if (result.rows.length === 0)
            return res.status(400).json({ message: "No se puede aplicar ese cambio de estado" })
        await logActivity({
            userId: req.user.id,
            action: "warehouse_order_status_updated",
            entityType: "order",
            entityId: Number(id),
            description: `Bodega cambio pedido a ${status}`,
            metadata: { status },
        }).catch((logErr) => console.error("Error registrando actividad:", logErr.message))
        notifyOrderStatus(result.rows[0].id, status)
            .catch((emailErr) => console.error("Error enviando estado bodega:", emailErr.message))
        res.json({
            message: "Estado del pedido actualizado correctamente",
            order: result.rows[0],
        })
    } catch (err) {
        res.status(500).json({ message: "Error al actualizar estado del pedido", error: err.message })
    }
}

// ===== CONTADOR =====

export const getAccountingOrders = async (req, res) => {
    try {
        await cancelExpiredPendingOrders()
        const orders = await pool.query(
            `SELECT o.*, u.name as user_name, u.email as user_email, u.phone as user_phone,
        COALESCE(json_agg(json_build_object(
          'product_id', oi.product_id,
          'name', p.name,
          'quantity', oi.quantity,
          'price', oi.price,
          'image_url', p.image_url
        )) FILTER (WHERE oi.id IS NOT NULL), '[]') as items
       FROM orders o
       JOIN users u ON o.user_id = u.id
       LEFT JOIN order_items oi ON o.id = oi.order_id
       LEFT JOIN products p ON oi.product_id = p.id
       WHERE o.status IN ('transfer_pending', 'paid', 'processing', 'shipped', 'delivered', 'cancelled')
       GROUP BY o.id, u.name, u.email, u.phone
       ORDER BY o.created_at DESC`
        )
        res.json({
            message: "Pedidos contables obtenidos correctamente",
            orders: orders.rows,
        })
    } catch (err) {
        res.status(500).json({ message: "Error al obtener pedidos contables", error: err.message })
    }
}

export const confirmTransferOrder = async (req, res) => {
    const { id } = req.params
    try {
        const result = await pool.query(
            `UPDATE orders
             SET status='paid'
             WHERE id=$1 AND status='transfer_pending'
             RETURNING *`,
            [id]
        )
        if (result.rows.length === 0)
            return res.status(400).json({ message: "El pedido no tiene transferencia pendiente" })
        await markServiceRequestsPaid(pool, result.rows[0].id)
        const productTotal = await pool.query(
            "SELECT COALESCE(SUM(quantity * price), 0) as total FROM order_items WHERE order_id=$1",
            [result.rows[0].id]
        )
        await addPointsForOrder(pool, result.rows[0].user_id, result.rows[0].id, productTotal.rows[0].total)
        await logActivity({
            userId: req.user.id,
            action: "transfer_confirmed",
            entityType: "order",
            entityId: Number(id),
            description: "Contador confirmo transferencia",
        }).catch((logErr) => console.error("Error registrando actividad:", logErr.message))
        notifyOrderStatus(result.rows[0].id, "paid")
            .catch((emailErr) => console.error("Error enviando transferencia confirmada:", emailErr.message))
        res.json({
            message: "Transferencia confirmada correctamente",
            order: result.rows[0],
        })
    } catch (err) {
        res.status(500).json({ message: "Error al confirmar transferencia", error: err.message })
    }
}

export const rejectTransferOrder = async (req, res) => {
    const { id } = req.params
    const client = await pool.connect()

    try {
        await client.query("BEGIN")
        const order = await client.query(
            "SELECT * FROM orders WHERE id=$1 AND status='transfer_pending'",
            [id]
        )

        if (order.rows.length === 0) {
            await client.query("ROLLBACK")
            return res.status(400).json({ message: "El pedido no tiene transferencia pendiente" })
        }

        const items = await client.query(
            "SELECT product_id, quantity FROM order_items WHERE order_id=$1",
            [id]
        )

        for (const item of items.rows) {
            await client.query(
                "UPDATE products SET stock = stock + $1 WHERE id=$2",
                [item.quantity, item.product_id]
            )
        }

        const result = await client.query(
            "UPDATE orders SET status='cancelled' WHERE id=$1 RETURNING *",
            [id]
        )
        await cancelServiceRequestsForOrder(client, id)
        await restoreUsedPointsForOrder(
            client,
            order.rows[0].user_id,
            id,
            "Devolucion por transferencia rechazada"
        )
        await client.query("COMMIT")
        await logActivity({
            userId: req.user.id,
            action: "transfer_rejected",
            entityType: "order",
            entityId: Number(id),
            description: "Contador rechazo transferencia",
        }).catch((logErr) => console.error("Error registrando actividad:", logErr.message))
        notifyOrderStatus(result.rows[0].id, "cancelled")
            .catch((emailErr) => console.error("Error enviando transferencia rechazada:", emailErr.message))
        res.json({
            message: "Transferencia rechazada correctamente",
            order: result.rows[0],
        })
    } catch (err) {
        await client.query("ROLLBACK")
        res.status(500).json({ message: "Error al rechazar transferencia", error: err.message })
    } finally {
        client.release()
    }
}

export const registerDeliveredOrder = async (req, res) => {
    const { id } = req.params
    try {
        const result = await pool.query(
            `UPDATE orders
             SET status='delivered'
             WHERE id=$1 AND status='shipped'
             RETURNING *`,
            [id]
        )
        if (result.rows.length === 0)
            return res.status(400).json({ message: "Solo se puede entregar un pedido despachado" })
        await logActivity({
            userId: req.user.id,
            action: "order_delivered",
            entityType: "order",
            entityId: Number(id),
            description: "Contador registro pedido entregado",
        }).catch((logErr) => console.error("Error registrando actividad:", logErr.message))
        notifyOrderStatus(result.rows[0].id, "delivered")
            .catch((emailErr) => console.error("Error enviando entrega:", emailErr.message))
        res.json({
            message: "Entrega registrada correctamente",
            order: result.rows[0],
        })
    } catch (err) {
        res.status(500).json({ message: "Error al registrar entrega", error: err.message })
    }
}
