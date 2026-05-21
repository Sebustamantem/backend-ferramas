import jwt from "jsonwebtoken"

export const verifyToken = (req, res, next) => {
    const authHeader = req.headers.authorization
    if (!authHeader || !authHeader.startsWith("Bearer "))
        return res.status(401).json({ message: "Token requerido" })

    const token = authHeader.split(" ")[1]
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET)
        req.user = decoded
        next()
    } catch {
        res.status(401).json({ message: "Token inválido" })
    }
}

export const verifyAdmin = (req, res, next) => {
    if (req.user.role !== "admin")
        return res.status(403).json({ message: "Acceso denegado, se requiere rol admin" })
    next()
}

export const verifyVendedor = (req, res, next) => {
    if (!["admin", "vendedor"].includes(req.user.role))
        return res.status(403).json({ message: "Acceso denegado, se requiere rol vendedor" })
    next()
}

export const verifyBodeguero = (req, res, next) => {
    if (!["admin", "bodeguero"].includes(req.user.role))
        return res.status(403).json({ message: "Acceso denegado, se requiere rol bodeguero" })
    next()
}

export const verifyContador = (req, res, next) => {
    if (!["admin", "contador"].includes(req.user.role))
        return res.status(403).json({ message: "Acceso denegado, se requiere rol contador" })
    next()
}

export const verifyStaff = (req, res, next) => {
    if (!["admin", "vendedor", "bodeguero", "contador"].includes(req.user.role))
        return res.status(403).json({ message: "Acceso denegado" })
    next()
}
