import pool from "../config/db.js"

// Admin: crear/actualizar crédito de un usuario
export const setCredit = async (req, res) => {
    const { userId } = req.params
    const { credit_limit, is_active } = req.body
    try {
        const exists = await pool.query(
            "SELECT id FROM ferre_credits WHERE user_id = $1",
            [userId]
        )
        let result
        if (exists.rows.length > 0) {
            result = await pool.query(
                `UPDATE ferre_credits SET credit_limit=$1, is_active=$2, updated_at=NOW()
         WHERE user_id=$3 RETURNING *`,
                [credit_limit, is_active, userId]
            )
        } else {
            result = await pool.query(
                `INSERT INTO ferre_credits (user_id, credit_limit, is_active)
         VALUES ($1, $2, $3) RETURNING *`,
                [userId, credit_limit, is_active]
            )
        }
        res.json(result.rows[0])
    } catch (err) {
        res.status(500).json({ message: "Error al configurar crédito", error: err.message })
    }
}

// Ver crédito propio
export const getMyCredit = async (req, res) => {
    try {
        const result = await pool.query(
            "SELECT * FROM ferre_credits WHERE user_id = $1",
            [req.user.id]
        )
        if (result.rows.length === 0)
            return res.json({ credit_limit: 0, balance_used: 0, is_active: false })
        res.json(result.rows[0])
    } catch (err) {
        res.status(500).json({ message: "Error al obtener crédito", error: err.message })
    }
}

// Admin: ver todos los créditos
export const getAllCredits = async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT fc.*, u.name, u.lastname, u.email, u.user_type
       FROM ferre_credits fc
       JOIN users u ON fc.user_id = u.id
       ORDER BY fc.created_at DESC`
        )
        res.json(result.rows)
    } catch (err) {
        res.status(500).json({ message: "Error al obtener créditos", error: err.message })
    }
}

// Pagar con FerreCredito
export const payWithCredit = async (req, res) => {
    const { installments, address } = req.body
    const client = await pool.connect()
    try {
        await client.query("BEGIN")

        // Verificar que es maestro o pyme
        const userResult = await client.query(
            "SELECT * FROM users WHERE id = $1",
            [req.user.id]
        )
        const user = userResult.rows[0]
        if (!["maestro", "pyme"].includes(user.user_type)) {
            await client.query("ROLLBACK")
            return res.status(403).json({ message: "Solo maestros y PYMEs pueden usar FerreCredito" })
        }

        // Verificar crédito disponible
        const creditResult = await client.query(
            "SELECT * FROM ferre_credits WHERE user_id = $1",
            [req.user.id]
        )
        if (creditResult.rows.length === 0 || !creditResult.rows[0].is_active) {
            await client.query("ROLLBACK")
            return res.status(400).json({ message: "No tienes FerreCredito activo" })
        }

        const credit = creditResult.rows[0]
        const available = Number(credit.credit_limit) - Number(credit.balance_used)

        // Verificar cuotas pendientes al día
        const pendingInstallments = await client.query(
            `SELECT * FROM ferre_credit_installments
       WHERE user_id = $1 AND status = 'active' AND paid_installments < installments`,
            [req.user.id]
        )

        // Obtener carrito
        const cartItems = await client.query(
            `SELECT ci.product_id, ci.quantity, p.price, p.name
       FROM cart_items ci
       JOIN products p ON ci.product_id = p.id
       WHERE ci.user_id = $1`,
            [req.user.id]
        )

        if (cartItems.rows.length === 0) {
            await client.query("ROLLBACK")
            return res.status(400).json({ message: "El carrito está vacío" })
        }

        let total = cartItems.rows.reduce(
            (acc, item) => acc + Number(item.price) * item.quantity, 0
        )

        // Aplicar descuento primera compra (30%)
        let discountApplied = false
        if (!user.first_purchase_used) {
            total = total * 0.7
            discountApplied = true
        }

        const shipping = total >= 50000 ? 0 : 4990
        const finalTotal = Math.round(total + shipping)

        // Verificar crédito disponible
        if (pendingInstallments.rows.length > 0) {
            await client.query("ROLLBACK")
            return res.status(400).json({
                message: "Debes estar al día en tus cuotas para realizar una nueva compra"
            })
        }

        if (available < finalTotal) {
            await client.query("ROLLBACK")
            return res.status(400).json({
                message: `Crédito insuficiente. Disponible: $${available.toLocaleString("es-CL")}`
            })
        }

        // Crear orden
        const orderResult = await client.query(
            `INSERT INTO orders (user_id, total, status, address)
       VALUES ($1, $2, 'paid', $3) RETURNING *`,
            [req.user.id, finalTotal, JSON.stringify(address)]
        )
        const order = orderResult.rows[0]

        for (const item of cartItems.rows) {
            await client.query(
                `INSERT INTO order_items (order_id, product_id, quantity, price)
         VALUES ($1, $2, $3, $4)`,
                [order.id, item.product_id, item.quantity, item.price]
            )
            // Descontar stock
            await client.query(
                "UPDATE products SET stock = stock - $1 WHERE id = $2",
                [item.quantity, item.product_id]
            )
        }

        // Crear cuotas
        const amountPerInstallment = Math.round(finalTotal / installments)
        await client.query(
            `INSERT INTO ferre_credit_installments
       (user_id, order_id, total_amount, installments, amount_per_installment)
       VALUES ($1, $2, $3, $4, $5)`,
            [req.user.id, order.id, finalTotal, installments, amountPerInstallment]
        )

        // Actualizar saldo usado
        await client.query(
            `UPDATE ferre_credits SET balance_used = balance_used + $1, updated_at = NOW()
       WHERE user_id = $2`,
            [finalTotal, req.user.id]
        )

        // Marcar primera compra usada
        if (discountApplied) {
            await client.query(
                "UPDATE users SET first_purchase_used = TRUE WHERE id = $1",
                [req.user.id]
            )
        }

        // Vaciar carrito
        await client.query("DELETE FROM cart_items WHERE user_id = $1", [req.user.id])
        await client.query("DELETE FROM stock_reservations WHERE user_id = $1", [req.user.id])

        await client.query("COMMIT")

        res.json({
            message: "Compra realizada con FerreCredito",
            order_id: order.id,
            total: finalTotal,
            installments,
            amount_per_installment: amountPerInstallment,
            discount_applied: discountApplied
        })
    } catch (err) {
        await client.query("ROLLBACK")
        res.status(500).json({ message: "Error al procesar pago", error: err.message })
    } finally {
        client.release()
    }
}

// Ver mis cuotas
export const getMyInstallments = async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT fci.*, o.total as order_total, o.created_at as order_date
       FROM ferre_credit_installments fci
       JOIN orders o ON fci.order_id = o.id
       WHERE fci.user_id = $1
       ORDER BY fci.created_at DESC`,
            [req.user.id]
        )
        res.json(result.rows)
    } catch (err) {
        res.status(500).json({ message: "Error al obtener cuotas", error: err.message })
    }
}

// Admin: registrar pago de cuota
export const payInstallment = async (req, res) => {
    const { installmentId } = req.params
    const client = await pool.connect()
    try {
        await client.query("BEGIN")

        const installment = await client.query(
            "SELECT * FROM ferre_credit_installments WHERE id = $1",
            [installmentId]
        )
        if (installment.rows.length === 0) {
            await client.query("ROLLBACK")
            return res.status(404).json({ message: "Cuota no encontrada" })
        }

        const inst = installment.rows[0]
        if (inst.paid_installments >= inst.installments) {
            await client.query("ROLLBACK")
            return res.status(400).json({ message: "Todas las cuotas ya están pagadas" })
        }

        // Registrar pago
        await client.query(
            `INSERT INTO ferre_credit_payments (installment_id, user_id, amount)
       VALUES ($1, $2, $3)`,
            [installmentId, inst.user_id, inst.amount_per_installment]
        )

        // Actualizar cuotas pagadas
        const newPaid = inst.paid_installments + 1
        const newStatus = newPaid >= inst.installments ? "completed" : "active"
        await client.query(
            `UPDATE ferre_credit_installments
       SET paid_installments = $1, status = $2
       WHERE id = $3`,
            [newPaid, newStatus, installmentId]
        )

        // Reducir saldo usado
        await client.query(
            `UPDATE ferre_credits SET balance_used = balance_used - $1, updated_at = NOW()
       WHERE user_id = $2`,
            [inst.amount_per_installment, inst.user_id]
        )

        await client.query("COMMIT")
        res.json({ message: "Cuota pagada correctamente" })
    } catch (err) {
        await client.query("ROLLBACK")
        res.status(500).json({ message: "Error al registrar pago", error: err.message })
    } finally {
        client.release()
    }
}