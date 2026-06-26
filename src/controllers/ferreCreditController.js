import { WebpayPlus, Options, IntegrationApiKeys, IntegrationCommerceCodes, Environment } from "transbank-sdk"
import pool from "../config/db.js"
import { ensureCommerceTables } from "../config/bootstrapAdmin.js"
import { releaseExpiredReservations } from "./cartController.js"
import { addPointsForOrder, ensurePointsTables, usePointsForOrder } from "./pointsController.js"
import { clearServiceCart, createServiceRequestsForOrder, ensureServiceTables, markServiceRequestsPaid } from "./serviceController.js"
import { logActivity } from "../utils/activityLog.js"
import {
    sendFerreCreditStatusEmail,
    sendOrderConfirmationEmail,
    sendUpcomingInstallmentEmail,
} from "../utils/email.js"

const tx = new WebpayPlus.Transaction(
    new Options(
        IntegrationCommerceCodes.WEBPAY_PLUS,
        IntegrationApiKeys.WEBPAY,
        Environment.Integration
    )
)

const buildFrontendRoute = (frontendUrl, path) => `${frontendUrl.replace(/\/$/, "")}${path}`
const WEBPAY_PENDING_MINUTES = 5

const getApprovedProfessionalType = (userType) => {
    if (userType === "maestro_pending") return "maestro"
    if (userType === "pyme_pending") return "pyme"
    return userType
}

const getDisplayName = (user = {}) => [user.name, user.lastname].filter(Boolean).join(" ").trim() || user.email

const getInstallmentDebt = (installment) => {
    const totalAmount = Number(installment.total_amount || 0)
    const paidAmount = Math.max(
        Number(installment.paid_amount || 0),
        Number(installment.paid_installments || 0) * Number(installment.amount_per_installment || 0)
    )
    return Math.max(totalAmount - paidAmount, 0)
}

const calculatePaidInstallments = (paidAmount, amountPerInstallment, installments) => {
    if (!amountPerInstallment) return 0
    return Math.min(Math.floor(Number(paidAmount || 0) / Number(amountPerInstallment || 1)), Number(installments || 0))
}

const expireOldPendingWebpayPayments = async (db = pool) => {
    await db.query(
        `UPDATE ferre_credit_payments
         SET status='expired'
         WHERE status='pending'
           AND created_at < NOW() - ($1::text || ' minutes')::interval`,
        [WEBPAY_PENDING_MINUTES]
    )
}

export const setCredit = async (req, res) => {
    const { userId } = req.params
    const { credit_limit, is_active } = req.body
    const limit = Number(credit_limit)
    if (!Number.isFinite(limit) || limit < 0) {
        return res.status(400).json({ message: "Limite de credito invalido" })
    }
    const client = await pool.connect()
    try {
        await client.query("BEGIN")
        const user = await client.query(
            "SELECT id, name, lastname, email, role, user_type FROM users WHERE id = $1",
            [userId]
        )
        if (user.rows.length === 0) {
            await client.query("ROLLBACK")
            return res.status(404).json({ message: "Usuario no encontrado" })
        }
        const currentType = user.rows[0].user_type
        const currentRole = user.rows[0].role
        if (!["maestro", "pyme", "maestro_pending", "pyme_pending"].includes(currentType)) {
            await client.query("ROLLBACK")
            return res.status(400).json({ message: "El usuario no tiene una postulacion FerreCredito" })
        }
        const approvedType = currentType === "maestro_pending" ? "maestro" : currentType === "pyme_pending" ? "pyme" : currentType
        if (approvedType !== currentType || currentRole !== approvedType) {
            await client.query(
                "UPDATE users SET user_type=$1, role=$1 WHERE id=$2",
                [approvedType, userId]
            )
        }
        const exists = await client.query(
            "SELECT id, balance_used FROM ferre_credits WHERE user_id = $1",
            [userId]
        )
        if (exists.rows.length > 0 && limit < Number(exists.rows[0].balance_used)) {
            await client.query("ROLLBACK")
            return res.status(400).json({ message: "El limite no puede ser menor al saldo usado" })
        }
        let result
        if (exists.rows.length > 0) {
            result = await client.query(
                `UPDATE ferre_credits SET credit_limit=$1, is_active=$2, updated_at=NOW()
         WHERE user_id=$3 RETURNING *`,
                [limit, is_active, userId]
            )
        } else {
            result = await client.query(
                `INSERT INTO ferre_credits (user_id, credit_limit, is_active)
         VALUES ($1, $2, $3) RETURNING *`,
                [userId, limit, is_active]
            )
        }
        await client.query("COMMIT")
        await logActivity({
            userId: req.user.id,
            action: "ferrecredit_approved",
            entityType: "user",
            entityId: Number(userId),
            description: "Admin aprobo o actualizo FerreCredito",
            metadata: { credit_limit: limit, is_active },
        }).catch((logErr) => console.error("Error registrando actividad:", logErr.message))
        sendFerreCreditStatusEmail({
            to: user.rows[0].email,
            name: getDisplayName(user.rows[0]),
            approved: is_active !== false && is_active !== "false",
            creditLimit: limit,
        }).catch((emailErr) => console.error("Error enviando correo FerreCredito:", emailErr.message))
        res.json({
            message: "FerreCredito configurado correctamente",
            credit: result.rows[0],
        })
    } catch (err) {
        try {
            await client.query("ROLLBACK")
        } catch (rollbackErr) {
            console.error("Error al revertir FerreCredito:", rollbackErr.message)
        }
        res.status(500).json({ message: "Error al configurar crédito", error: err.message })
    } finally {
        client.release()
    }
}

export const rejectCreditApplication = async (req, res) => {
    const { userId } = req.params
    const client = await pool.connect()

    try {
        await client.query("BEGIN")
        const user = await client.query(
            "SELECT id, name, lastname, email, user_type FROM users WHERE id=$1",
            [userId]
        )

        if (user.rows.length === 0) {
            await client.query("ROLLBACK")
            return res.status(404).json({ message: "Usuario no encontrado" })
        }

        if (!["maestro_pending", "pyme_pending"].includes(user.rows[0].user_type)) {
            await client.query("ROLLBACK")
            return res.status(400).json({ message: "El usuario no tiene una postulacion pendiente" })
        }

        await client.query("UPDATE users SET user_type='cliente', role='cliente' WHERE id=$1", [userId])
        await client.query(
            `UPDATE ferre_credits
             SET is_active=false, updated_at=NOW()
             WHERE user_id=$1`,
            [userId]
        )
        await client.query("COMMIT")
        await logActivity({
            userId: req.user.id,
            action: "ferrecredit_rejected",
            entityType: "user",
            entityId: Number(userId),
            description: "Admin rechazo postulacion FerreCredito",
        }).catch((logErr) => console.error("Error registrando actividad:", logErr.message))
        sendFerreCreditStatusEmail({
            to: user.rows[0].email,
            name: getDisplayName(user.rows[0]),
            approved: false,
        }).catch((emailErr) => console.error("Error enviando rechazo FerreCredito:", emailErr.message))
        res.json({ message: "Postulacion rechazada" })
    } catch (err) {
        try {
            await client.query("ROLLBACK")
        } catch (rollbackErr) {
            console.error("Error al revertir FerreCredito:", rollbackErr.message)
        }
        res.status(500).json({ message: "Error al rechazar postulacion", error: err.message })
    } finally {
        client.release()
    }
}

export const getMyCredit = async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT fc.*, u.user_type
             FROM users u
             LEFT JOIN ferre_credits fc ON fc.user_id = u.id
             WHERE u.id = $1`,
            [req.user.id]
        )
        if (result.rows.length === 0) {
            return res.status(404).json({ message: "Usuario no encontrado" })
        }

        const row = result.rows[0]
        const hasCredit = Boolean(row.id)
        const isPending = ["maestro_pending", "pyme_pending"].includes(row.user_type)
        const isApprovedProfessional = ["maestro", "pyme"].includes(row.user_type)
        const creditLimit = Number(row.credit_limit || 0)
        const balanceUsed = Number(row.balance_used || 0)
        const available = Math.max(creditLimit - balanceUsed, 0)

        let applicationStatus = "not_requested"
        let statusReason = "Aun no tienes una postulacion FerreCredito."

        if (isPending) {
            applicationStatus = "pending"
            statusReason = "Tu postulacion esta pendiente de aprobacion del administrador."
        } else if (isApprovedProfessional && row.is_active) {
            applicationStatus = "approved"
            statusReason = available > 0
                ? "Puedes usar tu cupo disponible en el checkout."
                : "No tienes cupo disponible para nuevas compras."
        } else if (isApprovedProfessional && hasCredit) {
            applicationStatus = "inactive"
            statusReason = "Tu linea existe, pero el administrador la dejo inactiva."
        } else if (hasCredit && !row.is_active) {
            applicationStatus = "rejected"
            statusReason = "Tu postulacion fue rechazada o desactivada por administracion."
        }

        const creditData = {
            id: row.id || null,
            user_id: req.user.id,
            user_type: row.user_type,
            credit_limit: creditLimit,
            balance_used: balanceUsed,
            available,
            is_active: Boolean(row.is_active),
            application_status: applicationStatus,
            status_reason: statusReason,
            can_buy: applicationStatus === "approved" && available > 0,
            created_at: row.created_at || null,
            updated_at: row.updated_at || null,
        }
        res.json({
            message: "FerreCredito obtenido correctamente",
            credit: creditData,
            ...creditData,
        })
    } catch (err) {
        res.status(500).json({ message: "Error al obtener crédito", error: err.message })
    }
}

export const getAllCredits = async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT fc.*, u.name, u.lastname, u.email, u.user_type
       FROM ferre_credits fc
       JOIN users u ON fc.user_id = u.id
       ORDER BY fc.created_at DESC`
        )
        res.json({
            message: "Créditos obtenidos correctamente",
            credits: result.rows,
        })
    } catch (err) {
        res.status(500).json({ message: "Error al obtener créditos", error: err.message })
    }
}

export const getAllInstallments = async (req, res) => {
    try {
        await ensureCommerceTables()
        await expireOldPendingWebpayPayments()
        const result = await pool.query(
            `SELECT fci.*, u.name as user_name, u.email as user_email,
                    CASE
                        WHEN EXISTS (
                            SELECT 1 FROM ferre_credit_payments fcp
                            WHERE fcp.installment_id=fci.id
                              AND fcp.status='pending'
                              AND fcp.created_at >= NOW() - ($1::text || ' minutes')::interval
                        )
                        THEN 'webpay_pending'
                        WHEN fci.status='active'
                         AND fci.payment_requested_at IS NOT NULL
                         AND fci.paid_installments < fci.installments
                        THEN 'payment_pending'
                        WHEN fci.status='active'
                         AND fci.due_date IS NOT NULL
                         AND fci.due_date < NOW()
                         AND fci.paid_installments < fci.installments
                        THEN 'overdue'
                        ELSE fci.status
                    END as effective_status
       FROM ferre_credit_installments fci
       JOIN users u ON fci.user_id = u.id
       ORDER BY fci.created_at DESC`
            ,
            [WEBPAY_PENDING_MINUTES]
        )
        res.json({
            message: "Cuotas obtenidas correctamente",
            installments: result.rows,
        })
    } catch (err) {
        res.status(500).json({ message: "Error al obtener cuotas", error: err.message })
    }
}

export const payWithCredit = async (req, res) => {
    const { installments, address, points_to_use = 0, delivery_method = "delivery" } = req.body
    const client = await pool.connect()
    let transactionFinished = false
    let orderIdToNotify = null
    try {
        await releaseExpiredReservations()
        await ensurePointsTables()
        await ensureServiceTables()
        await client.query("BEGIN")
        const deliveryMethod = delivery_method === "pickup" ? "pickup" : "delivery"

        const userResult = await client.query(
            "SELECT * FROM users WHERE id = $1",
            [req.user.id]
        )
        const user = userResult.rows[0]

        const creditResult = await client.query(
            "SELECT * FROM ferre_credits WHERE user_id = $1",
            [req.user.id]
        )
        if (creditResult.rows.length === 0 || !creditResult.rows[0].is_active) {
            await client.query("ROLLBACK")
            return res.status(400).json({ message: "No tienes FerreCredito activo" })
        }

        const credit = creditResult.rows[0]
        const approvedType = getApprovedProfessionalType(user.user_type)
        if (!["maestro", "pyme"].includes(approvedType)) {
            await client.query("ROLLBACK")
            return res.status(403).json({ message: "Solo maestros y PYMEs pueden usar FerreCredito" })
        }
        if (approvedType !== user.user_type || user.role !== approvedType) {
            await client.query(
                "UPDATE users SET user_type=$1, role=$1 WHERE id=$2",
                [approvedType, req.user.id]
            )
            user.user_type = approvedType
            user.role = approvedType
        }

        const available = Number(credit.credit_limit) - Number(credit.balance_used)

        const cartItems = await client.query(
            `SELECT ci.product_id, ci.quantity, p.price, p.name
       FROM cart_items ci
       JOIN products p ON ci.product_id = p.id
       WHERE ci.user_id = $1`,
            [req.user.id]
        )

        const serviceCart = await client.query("SELECT COUNT(*)::int as count FROM service_cart_items WHERE user_id=$1", [req.user.id])
        const serviceTotal = Number(serviceCart.rows[0]?.count || 0) * 5000

        if (cartItems.rows.length === 0 && serviceTotal === 0) {
            await client.query("ROLLBACK")
            return res.status(400).json({ message: "El carrito está vacío" })
        }

        const productSubtotal = cartItems.rows.reduce(
            (acc, item) => acc + Number(item.price) * item.quantity, 0
        )
        let total = productSubtotal
        total += serviceTotal

        let discountApplied = false
        if (!user.first_purchase_used) {
            total = total * 0.7
            discountApplied = true
        }

        const discountedProductTotal = !user.first_purchase_used ? productSubtotal * 0.7 : productSubtotal
        const shipping = deliveryMethod === "delivery" && discountedProductTotal > 0 && discountedProductTotal < 50000 ? 4990 : 0
        const beforePointsTotal = Math.round(total + shipping)

        const orderResult = await client.query(
            `INSERT INTO orders (user_id, total, status, address, delivery_method)
       VALUES ($1, $2, 'paid', $3, $4) RETURNING *`,
            [req.user.id, beforePointsTotal, JSON.stringify(address), deliveryMethod]
        )
        const order = orderResult.rows[0]
        const pointsUsed = await usePointsForOrder(client, req.user.id, order.id, points_to_use, beforePointsTotal)
        const finalTotal = Math.max(beforePointsTotal - pointsUsed, 0)
        if (pointsUsed > 0) {
            await client.query("UPDATE orders SET total=$1 WHERE id=$2", [finalTotal, order.id])
        }

        if (available < finalTotal) {
            await client.query("ROLLBACK")
            return res.status(400).json({
                message: `No tienes cupo suficiente en FerreCredito. Disponible: $${available.toLocaleString("es-CL")}`
            })
        }

        for (const item of cartItems.rows) {
            await client.query(
                `INSERT INTO order_items (order_id, product_id, quantity, price)
         VALUES ($1, $2, $3, $4)`,
                [order.id, item.product_id, item.quantity, item.price]
            )
        }
        await createServiceRequestsForOrder(client, req.user.id, order.id, "paid_contact_fee", false)
        orderIdToNotify = order.id

        const amountPerInstallment = Math.round(finalTotal / installments)
        const installmentResult = await client.query(
            `INSERT INTO ferre_credit_installments
       (user_id, order_id, total_amount, installments, amount_per_installment, due_date)
       VALUES ($1, $2, $3, $4, $5, NOW() + INTERVAL '30 days')
       RETURNING *`,
            [req.user.id, order.id, finalTotal, installments, amountPerInstallment]
        )

        await client.query(
            `UPDATE ferre_credits SET balance_used = balance_used + $1, updated_at = NOW()
       WHERE user_id = $2`,
            [finalTotal, req.user.id]
        )

        if (discountApplied) {
            await client.query(
                "UPDATE users SET first_purchase_used = TRUE WHERE id = $1",
                [req.user.id]
            )
        }

        await client.query("DELETE FROM cart_items WHERE user_id = $1", [req.user.id])
        await client.query("DELETE FROM stock_reservations WHERE user_id = $1", [req.user.id])
        await clearServiceCart(client, req.user.id, false)
        const pointsEarned = await addPointsForOrder(client, req.user.id, order.id, discountedProductTotal)

        await client.query("COMMIT")
        transactionFinished = true

        if (orderIdToNotify) {
            try {
                await markServiceRequestsPaid(pool, orderIdToNotify)
            } catch (notifyErr) {
                console.error("Error al notificar servicios pagados:", notifyErr.message)
            }
        }

        sendOrderConfirmationEmail({
            to: user.email,
            name: getDisplayName(user),
            order: { ...order, total: finalTotal, status: "paid" },
            items: cartItems.rows,
            paymentMethod: "FerreCredito",
        }).catch((emailErr) => console.error("Error enviando confirmacion FerreCredito:", emailErr.message))

        sendUpcomingInstallmentEmail({
            to: user.email,
            name: getDisplayName(user),
            installment: installmentResult.rows[0],
        }).catch((emailErr) => console.error("Error enviando aviso de cuota:", emailErr.message))

        res.json({
            message: "Compra realizada con FerreCredito",
            order_id: order.id,
            total: finalTotal,
            installments,
            amount_per_installment: amountPerInstallment,
            discount_applied: discountApplied,
            points_used: pointsUsed,
            points_earned: pointsEarned
        })
    } catch (err) {
        if (!transactionFinished) {
            try {
                await client.query("ROLLBACK")
            } catch (rollbackErr) {
                console.error("Error al revertir pago FerreCredito:", rollbackErr.message)
            }
        }
        res.status(500).json({ message: "Error al procesar pago", error: err.message })
    } finally {
        client.release()
    }
}

export const getMyInstallments = async (req, res) => {
    try {
        await ensureCommerceTables()
        await expireOldPendingWebpayPayments()
        const result = await pool.query(
            `SELECT fci.*, o.total as order_total, o.created_at as order_date,
                    CASE
                        WHEN EXISTS (
                            SELECT 1 FROM ferre_credit_payments fcp
                            WHERE fcp.installment_id=fci.id
                              AND fcp.status='pending'
                              AND fcp.created_at >= NOW() - ($2::text || ' minutes')::interval
                        )
                        THEN 'webpay_pending'
                        WHEN fci.status='active'
                         AND fci.payment_requested_at IS NOT NULL
                         AND fci.paid_installments < fci.installments
                        THEN 'payment_pending'
                        WHEN fci.status='active'
                         AND fci.due_date IS NOT NULL
                         AND fci.due_date < NOW()
                         AND fci.paid_installments < fci.installments
                        THEN 'overdue'
                        ELSE fci.status
                    END as effective_status
       FROM ferre_credit_installments fci
       JOIN orders o ON fci.order_id = o.id
       WHERE fci.user_id = $1
       ORDER BY fci.created_at DESC`,
            [req.user.id, WEBPAY_PENDING_MINUTES]
        )
        res.json({
            message: "Cuotas obtenidas correctamente",
            installments: result.rows,
        })
    } catch (err) {
        res.status(500).json({ message: "Error al obtener cuotas", error: err.message })
    }
}

export const requestInstallmentPayment = async (req, res) => {
    const { installmentId } = req.params

    try {
        await ensureCommerceTables()
        const installment = await pool.query(
            `SELECT *
             FROM ferre_credit_installments
             WHERE id=$1 AND user_id=$2
             LIMIT 1`,
            [installmentId, req.user.id]
        )

        if (installment.rows.length === 0) {
            return res.status(404).json({ message: "Cuota no encontrada" })
        }

        const inst = installment.rows[0]
        if (Number(inst.paid_installments || 0) >= Number(inst.installments || 0) || inst.status === "completed") {
            return res.status(400).json({ message: "Esta compra ya tiene todas sus cuotas pagadas" })
        }

        if (inst.payment_requested_at) {
            return res.status(409).json({ message: "Ya informaste un pago para esta cuota. Espera confirmacion del administrador." })
        }

        const result = await pool.query(
            `UPDATE ferre_credit_installments
             SET payment_requested_at=NOW()
             WHERE id=$1 AND user_id=$2
             RETURNING *`,
            [installmentId, req.user.id]
        )

        res.json({
            message: "Pago informado. El administrador debe confirmarlo.",
            installment: result.rows[0],
        })
    } catch (err) {
        res.status(500).json({ message: "Error al informar pago", error: err.message })
    }
}

export const createInstallmentWebpayPayment = async (req, res) => {
    const { installmentId } = req.params
    const { payment_type = "installment", amount } = req.body
    const backendUrl = process.env.BACKEND_URL

    if (!backendUrl) {
        return res.status(500).json({ message: "BACKEND_URL no está configurado" })
    }

    try {
        await ensureCommerceTables()
        await expireOldPendingWebpayPayments()

        const installmentResult = await pool.query(
            `SELECT fci.*, u.user_type, u.role
             FROM ferre_credit_installments fci
             JOIN users u ON u.id=fci.user_id
             WHERE fci.id=$1 AND fci.user_id=$2
             LIMIT 1`,
            [installmentId, req.user.id]
        )

        if (installmentResult.rows.length === 0) {
            return res.status(404).json({ message: "Cuota no encontrada" })
        }

        const installment = installmentResult.rows[0]
        const userType = getApprovedProfessionalType(installment.user_type)
        if (!["maestro", "pyme"].includes(userType)) {
            return res.status(403).json({ message: "Solo maestros y PYMEs pueden pagar FerreCredito" })
        }

        const remainingDebt = getInstallmentDebt(installment)
        if (remainingDebt <= 0 || installment.status === "completed") {
            return res.status(400).json({ message: "Esta compra ya está pagada" })
        }

        await pool.query(
            `UPDATE ferre_credit_payments
             SET status='rejected'
             WHERE installment_id=$1 AND user_id=$2 AND status='pending'`,
            [installmentId, req.user.id]
        )

        let paymentAmount
        if (payment_type === "total") {
            paymentAmount = remainingDebt
        } else if (payment_type === "custom") {
            paymentAmount = Math.round(Number(amount || 0))
        } else {
            const nextInstallmentAmount = Math.min(Number(installment.amount_per_installment || 0), remainingDebt)
            paymentAmount = Math.round(nextInstallmentAmount)
        }

        if (!Number.isFinite(paymentAmount) || paymentAmount <= 0) {
            return res.status(400).json({ message: "Monto de pago invalido" })
        }
        if (paymentAmount > remainingDebt) {
            return res.status(400).json({ message: `El monto no puede superar la deuda pendiente: $${remainingDebt.toLocaleString("es-CL")}` })
        }

        const buyOrder = `FC-${installmentId}-${Date.now()}`
        const sessionId = `FCSESSION-${req.user.id}-${Date.now()}`
        const returnUrl = `${backendUrl.replace(/\/$/, "")}/api/ferre-credit/payments/confirm`

        const response = await tx.create(buyOrder, sessionId, paymentAmount, returnUrl)

        const payment = await pool.query(
            `INSERT INTO ferre_credit_payments (installment_id, user_id, amount, status, transbank_token, buy_order)
             VALUES ($1, $2, $3, 'pending', $4, $5)
             RETURNING *`,
            [installmentId, req.user.id, paymentAmount, response.token, buyOrder]
        )

        res.status(201).json({
            message: "Pago Webpay de FerreCredito creado correctamente",
            url: response.url,
            token: response.token,
            payment: payment.rows[0],
        })
    } catch (err) {
        console.error("Error creando pago Webpay FerreCredito:", err)
        res.status(500).json({ message: "Error al crear pago Webpay", error: err.message })
    }
}

export const confirmInstallmentWebpayPayment = async (req, res) => {
    const token_ws = req.query.token_ws || req.body?.token_ws
    const frontendUrl = process.env.FRONTEND_URL

    if (!frontendUrl) {
        return res.status(500).json({ message: "FRONTEND_URL no está configurado" })
    }

    if (!token_ws) {
        return res.redirect(buildFrontendRoute(frontendUrl, "/mi-credito?payment=failure"))
    }

    const client = await pool.connect()

    try {
        await ensureCommerceTables()
        await expireOldPendingWebpayPayments()
        const pendingPayment = await pool.query(
            "SELECT id FROM ferre_credit_payments WHERE transbank_token=$1 AND status='pending' LIMIT 1",
            [token_ws]
        )
        if (pendingPayment.rows.length === 0) {
            return res.redirect(buildFrontendRoute(frontendUrl, "/mi-credito?payment=failure"))
        }

        const response = await tx.commit(token_ws)

        await client.query("BEGIN")
        const paymentResult = await client.query(
            `SELECT fcp.*, fci.total_amount, fci.amount_per_installment, fci.installments,
                    fci.paid_amount, fci.paid_installments, fci.status as installment_status
             FROM ferre_credit_payments fcp
             JOIN ferre_credit_installments fci ON fci.id=fcp.installment_id
             WHERE fcp.transbank_token=$1 AND fcp.status='pending'
             FOR UPDATE`,
            [token_ws]
        )

        if (paymentResult.rows.length === 0) {
            await client.query("ROLLBACK")
            return res.redirect(buildFrontendRoute(frontendUrl, "/mi-credito?payment=failure"))
        }

        const payment = paymentResult.rows[0]

        if (response.status !== "AUTHORIZED") {
            await client.query(
                "UPDATE ferre_credit_payments SET status='rejected' WHERE id=$1",
                [payment.id]
            )
            await client.query("COMMIT")
            return res.redirect(buildFrontendRoute(frontendUrl, "/mi-credito?payment=failure"))
        }

        const previousPaidAmount = Math.max(
            Number(payment.paid_amount || 0),
            Number(payment.paid_installments || 0) * Number(payment.amount_per_installment || 0)
        )
        const newPaidAmount = Math.min(previousPaidAmount + Number(payment.amount || 0), Number(payment.total_amount || 0))
        const newPaidInstallments = calculatePaidInstallments(newPaidAmount, payment.amount_per_installment, payment.installments)
        const newStatus = newPaidAmount >= Number(payment.total_amount || 0) ? "completed" : "active"

        await client.query(
            "UPDATE ferre_credit_payments SET status='paid' WHERE id=$1",
            [payment.id]
        )
        const updatedInstallment = await client.query(
            `UPDATE ferre_credit_installments
             SET paid_amount=$1,
                 paid_installments=$2,
                 status=$3,
                 payment_requested_at=NULL,
                 due_date=CASE
                    WHEN $3='completed' THEN due_date
                    WHEN $2 > paid_installments THEN COALESCE(due_date, NOW()) + INTERVAL '30 days'
                    ELSE due_date
                 END
             WHERE id=$4
             RETURNING *`,
            [newPaidAmount, newPaidInstallments, newStatus, payment.installment_id]
        )
        await client.query(
            `UPDATE ferre_credits
             SET balance_used=GREATEST(balance_used - $1, 0), updated_at=NOW()
             WHERE user_id=$2`,
            [Number(payment.amount || 0), payment.user_id]
        )
        await client.query("COMMIT")

        if (newStatus === "active") {
            Promise.resolve()
                .then(async () => {
                    const user = await pool.query("SELECT name, lastname, email FROM users WHERE id=$1", [payment.user_id])
                    if (user.rows[0]?.email) {
                        await sendUpcomingInstallmentEmail({
                            to: user.rows[0].email,
                            name: getDisplayName(user.rows[0]),
                            installment: updatedInstallment.rows[0],
                        })
                    }
                })
                .catch((emailErr) => console.error("Error enviando proxima cuota:", emailErr.message))
        }

        return res.redirect(buildFrontendRoute(frontendUrl, "/mi-credito?payment=success"))
    } catch (err) {
        try {
            await client.query("ROLLBACK")
        } catch (rollbackErr) {
            console.error("Error rollback pago Webpay FerreCredito:", rollbackErr.message)
        }
        console.error("Error confirmando pago Webpay FerreCredito:", err)
        return res.redirect(buildFrontendRoute(frontendUrl, "/mi-credito?payment=failure"))
    } finally {
        client.release()
    }
}

export const payInstallment = async (req, res) => {
    const { installmentId } = req.params
    const client = await pool.connect()
    let transactionFinished = false
    try {
        await ensureCommerceTables()
        await client.query("BEGIN")

        const installment = await client.query(
            "SELECT * FROM ferre_credit_installments WHERE id = $1 FOR UPDATE",
            [installmentId]
        )
        if (installment.rows.length === 0) {
            await client.query("ROLLBACK")
            return res.status(404).json({ message: "Cuota no encontrada" })
        }

        const inst = installment.rows[0]
        const paidInstallments = Number(inst.paid_installments || 0)
        const totalInstallments = Number(inst.installments || 0)
        const totalAmount = Number(inst.total_amount || 0)
        const amountPerInstallment = Number(inst.amount_per_installment || 0)

        if (paidInstallments >= totalInstallments) {
            await client.query("ROLLBACK")
            return res.status(400).json({ message: "Todas las cuotas ya están pagadas" })
        }

        if (!inst.payment_requested_at) {
            await client.query("ROLLBACK")
            return res.status(400).json({ message: "El cliente aun no ha informado el pago de esta cuota" })
        }

        const remainingAmount = totalAmount - (amountPerInstallment * paidInstallments)
        const paymentAmount = Math.min(amountPerInstallment, remainingAmount)

        if (!Number.isFinite(paymentAmount) || paymentAmount <= 0) {
            await client.query("ROLLBACK")
            return res.status(400).json({ message: "La cuota no tiene monto pendiente" })
        }

        await client.query(
            `INSERT INTO ferre_credit_payments (installment_id, user_id, amount)
       VALUES ($1, $2, $3)`,
            [installmentId, inst.user_id, paymentAmount]
        )

        const newPaid = paidInstallments + 1
        const newStatus = newPaid >= totalInstallments ? "completed" : "active"
        const newPaidAmount = Math.min(
            Math.max(Number(inst.paid_amount || 0), paidInstallments * amountPerInstallment) + paymentAmount,
            totalAmount
        )
        const updatedInstallment = await client.query(
            `UPDATE ferre_credit_installments
       SET paid_amount = $1,
           paid_installments = $2,
           status = $3,
           due_date = CASE
                WHEN $3 = 'completed' THEN due_date
                ELSE COALESCE(due_date, NOW()) + INTERVAL '30 days'
           END,
           payment_requested_at = NULL
       WHERE id = $4
       RETURNING *`,
            [newPaidAmount, newPaid, newStatus, installmentId]
        )

        await client.query(
            `UPDATE ferre_credits SET balance_used = GREATEST(balance_used - $1, 0), updated_at = NOW()
       WHERE user_id = $2`,
            [paymentAmount, inst.user_id]
        )

        await client.query("COMMIT")
        transactionFinished = true
        await logActivity({
            userId: req.user.id,
            action: "ferrecredit_installment_paid",
            entityType: "ferre_credit_installment",
            entityId: Number(installmentId),
            description: "Admin registro pago de cuota FerreCredito",
            metadata: { amount: paymentAmount, paid_installments: newPaid },
        }).catch((logErr) => console.error("Error registrando actividad:", logErr.message))

        if (newStatus === "active") {
            Promise.resolve()
                .then(async () => {
                    const user = await pool.query(
                        "SELECT name, lastname, email FROM users WHERE id=$1",
                        [inst.user_id]
                    )
                    if (user.rows[0]?.email) {
                        await sendUpcomingInstallmentEmail({
                            to: user.rows[0].email,
                            name: getDisplayName(user.rows[0]),
                            installment: updatedInstallment.rows[0],
                        })
                    }
                })
                .catch((emailErr) => console.error("Error enviando proxima cuota:", emailErr.message))
        }

        return res.json({ message: "Cuota pagada correctamente" })
    } catch (err) {
        if (!transactionFinished) {
            try {
                await client.query("ROLLBACK")
            } catch (rollbackErr) {
                console.error("Error al revertir pago FerreCredito (payInstallment):", rollbackErr)
            }
        }
        console.error("Error al registrar pago (payInstallment):", err)
        res.status(500).json({ message: "Error al registrar pago", error: err.message })
    } finally {
        client.release()
    }
}
