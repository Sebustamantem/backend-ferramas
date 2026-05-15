import pool from "../config/db.js"

const releaseExpiredReservations = async () => {
    const expired = await pool.query(
        `SELECT * FROM stock_reservations WHERE expires_at < NOW()`
    )
    for (const reservation of expired.rows) {
        await pool.query(
            "UPDATE products SET stock = stock + $1 WHERE id = $2",
            [reservation.quantity, reservation.product_id]
        )
    }
    await pool.query("DELETE FROM stock_reservations WHERE expires_at < NOW()")
}

export const getCart = async (req, res) => {
    try {
        await releaseExpiredReservations()
        const result = await pool.query(
            `SELECT ci.id, ci.product_id, p.name, p.price, p.image_url, ci.quantity
       FROM cart_items ci
       JOIN products p ON ci.product_id = p.id
       WHERE ci.user_id = $1`,
            [req.user.id]
        )
        res.json(result.rows)
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

        await client.query("COMMIT")
        res.json({ message: "Carrito vaciado correctamente" })
    } catch (err) {
        await client.query("ROLLBACK")
        res.status(500).json({ message: "Error al vaciar carrito", error: err.message })
    } finally {
        client.release()
    }
}