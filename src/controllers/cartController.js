import pool from "../config/db.js"
import { clearServiceCart, ensureServiceTables } from "./serviceController.js"

export const releaseExpiredReservations = async () => {
    const client = await pool.connect()
    try {
        await client.query("BEGIN")
        const expired = await client.query(
            `SELECT * FROM stock_reservations WHERE expires_at < NOW() FOR UPDATE`
        )
        for (const reservation of expired.rows) {
            await client.query(
                "UPDATE products SET stock = stock + $1 WHERE id = $2",
                [reservation.quantity, reservation.product_id]
            )
            await client.query(
                "DELETE FROM cart_items WHERE user_id = $1 AND product_id = $2",
                [reservation.user_id, reservation.product_id]
            )
        }
        await client.query("DELETE FROM stock_reservations WHERE expires_at < NOW()")
        await client.query("COMMIT")
    } catch (err) {
        await client.query("ROLLBACK")
        throw err
    } finally {
        client.release()
    }
}

export const getCart = async (req, res) => {
    try {
        await releaseExpiredReservations()
        await ensureServiceTables()
        const products = await pool.query(
            `SELECT ci.id, ci.product_id, p.name, p.price, p.image_url, ci.quantity,
                    sr.expires_at as reservation_expires_at,
                    'product' as item_type,
                    NULL as service_id,
                    NULL as professional_name,
                    NULL as professional_email,
                    NULL as professional_phone
       FROM cart_items ci
       JOIN products p ON ci.product_id = p.id
       LEFT JOIN stock_reservations sr
         ON sr.user_id = ci.user_id AND sr.product_id = ci.product_id
       WHERE ci.user_id = $1`,
            [req.user.id]
        )
        const services = await pool.query(
            `SELECT sci.id, NULL as product_id, ps.id as service_id, ps.title as name,
                    5000 as price, NULL as image_url, 1 as quantity,
                    NULL as reservation_expires_at,
                    'service' as item_type,
                    CONCAT(u.name, ' ', COALESCE(u.lastname, '')) as professional_name,
                    u.email as professional_email,
                    ps.phone as professional_phone
             FROM service_cart_items sci
             JOIN professional_services ps ON sci.service_id = ps.id
             JOIN users u ON ps.user_id = u.id
             WHERE sci.user_id = $1`,
            [req.user.id]
        )
        res.json([...products.rows, ...services.rows])
    } catch (err) {
        res.status(500).json({ message: "Error al obtener carrito", error: err.message })
    }
}

export const addToCart = async (req, res) => {
    const { product_id, quantity = 1 } = req.body
    const client = await pool.connect()
    try {
        await releaseExpiredReservations()
        await client.query("BEGIN")

        const productResult = await client.query(
            "SELECT * FROM products WHERE id = $1 FOR UPDATE",
            [product_id]
        )
        if (productResult.rows.length === 0) {
            await client.query("ROLLBACK")
            return res.status(404).json({ message: "Producto no encontrado" })
        }

        const product = productResult.rows[0]
        if (product.stock < quantity) {
            await client.query("ROLLBACK")
            return res.status(400).json({ message: "Stock insuficiente" })
        }

        const existing = await client.query(
            "SELECT * FROM cart_items WHERE user_id = $1 AND product_id = $2",
            [req.user.id, product_id]
        )

        if (existing.rows.length > 0) {
            await client.query(
                "UPDATE cart_items SET quantity = quantity + $1 WHERE user_id = $2 AND product_id = $3",
                [quantity, req.user.id, product_id]
            )
            await client.query(
                `UPDATE stock_reservations 
         SET quantity = quantity + $1, expires_at = NOW() + INTERVAL '10 minutes'
         WHERE user_id = $2 AND product_id = $3`,
                [quantity, req.user.id, product_id]
            )
        } else {
            await client.query(
                "INSERT INTO cart_items (user_id, product_id, quantity) VALUES ($1, $2, $3)",
                [req.user.id, product_id, quantity]
            )
            await client.query(
                `INSERT INTO stock_reservations (user_id, product_id, quantity, expires_at)
         VALUES ($1, $2, $3, NOW() + INTERVAL '10 minutes')`,
                [req.user.id, product_id, quantity]
            )
        }

        await client.query(
            "UPDATE products SET stock = stock - $1 WHERE id = $2",
            [quantity, product_id]
        )

        await client.query("COMMIT")
        res.status(201).json({ message: "Producto agregado al carrito" })
    } catch (err) {
        await client.query("ROLLBACK")
        res.status(500).json({ message: "Error al agregar al carrito", error: err.message })
    } finally {
        client.release()
    }
}

export const updateQuantity = async (req, res) => {
    const { productId } = req.params
    const { quantity } = req.body
    const client = await pool.connect()
    try {
        await releaseExpiredReservations()
        await client.query("BEGIN")

        const cartItem = await client.query(
            "SELECT * FROM cart_items WHERE user_id = $1 AND product_id = $2",
            [req.user.id, productId]
        )

        if (cartItem.rows.length === 0) {
            await client.query("ROLLBACK")
            return res.status(404).json({ message: "Producto no encontrado en carrito" })
        }

        const oldQuantity = cartItem.rows[0].quantity
        const diff = quantity - oldQuantity

        if (diff > 0) {
            const product = await client.query(
                "SELECT stock FROM products WHERE id = $1 FOR UPDATE",
                [productId]
            )
            if (product.rows[0].stock < diff) {
                await client.query("ROLLBACK")
                return res.status(400).json({ message: "Stock insuficiente" })
            }
            await client.query(
                "UPDATE products SET stock = stock - $1 WHERE id = $2",
                [diff, productId]
            )
        } else {
            await client.query(
                "UPDATE products SET stock = stock + $1 WHERE id = $2",
                [Math.abs(diff), productId]
            )
        }

        await client.query(
            "UPDATE cart_items SET quantity = $1 WHERE user_id = $2 AND product_id = $3",
            [quantity, req.user.id, productId]
        )

        await client.query(
            `UPDATE stock_reservations SET quantity = $1, expires_at = NOW() + INTERVAL '10 minutes'
       WHERE user_id = $2 AND product_id = $3`,
            [quantity, req.user.id, productId]
        )

        await client.query("COMMIT")
        res.json({ message: "Cantidad actualizada" })
    } catch (err) {
        await client.query("ROLLBACK")
        res.status(500).json({ message: "Error al actualizar cantidad", error: err.message })
    } finally {
        client.release()
    }
}

export const removeFromCart = async (req, res) => {
    const { productId } = req.params
    const client = await pool.connect()
    try {
        await client.query("BEGIN")

        const cartItem = await client.query(
            "SELECT * FROM cart_items WHERE user_id = $1 AND product_id = $2",
            [req.user.id, productId]
        )

        if (cartItem.rows.length > 0) {
            const quantity = cartItem.rows[0].quantity
            await client.query(
                "UPDATE products SET stock = stock + $1 WHERE id = $2",
                [quantity, productId]
            )
            await client.query(
                "DELETE FROM stock_reservations WHERE user_id = $1 AND product_id = $2",
                [req.user.id, productId]
            )
            await client.query(
                "DELETE FROM cart_items WHERE user_id = $1 AND product_id = $2",
                [req.user.id, productId]
            )
        }

        await client.query("COMMIT")
        res.json({ message: "Producto eliminado del carrito" })
    } catch (err) {
        await client.query("ROLLBACK")
        res.status(500).json({ message: "Error al eliminar del carrito", error: err.message })
    } finally {
        client.release()
    }
}

export const clearCart = async (req, res) => {
    const client = await pool.connect()
    try {
        await client.query("BEGIN")

        const cartItems = await client.query(
            "SELECT * FROM cart_items WHERE user_id = $1",
            [req.user.id]
        )

        for (const item of cartItems.rows) {
            await client.query(
                "UPDATE products SET stock = stock + $1 WHERE id = $2",
                [item.quantity, item.product_id]
            )
        }

        await client.query(
            "DELETE FROM stock_reservations WHERE user_id = $1",
            [req.user.id]
        )
        await client.query(
            "DELETE FROM cart_items WHERE user_id = $1",
            [req.user.id]
        )
        await clearServiceCart(client, req.user.id)

        await client.query("COMMIT")
        res.json({ message: "Carrito vaciado correctamente" })
    } catch (err) {
        await client.query("ROLLBACK")
        res.status(500).json({ message: "Error al vaciar carrito", error: err.message })
    } finally {
        client.release()
    }
}
