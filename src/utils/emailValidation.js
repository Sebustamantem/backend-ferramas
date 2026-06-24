import { promises as dns } from "dns"

const disposableEmailDomains = new Set([
    "10minutemail.com",
    "10minutemail.net",
    "20minutemail.com",
    "anonaddy.com",
    "dispostable.com",
    "emailondeck.com",
    "fakeinbox.com",
    "getnada.com",
    "guerrillamail.com",
    "guerrillamail.net",
    "maildrop.cc",
    "mailinator.com",
    "moakt.com",
    "sharklasers.com",
    "temp-mail.org",
    "tempmail.com",
    "throwawaymail.com",
    "trashmail.com",
    "yopmail.com",
])

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

export const validateRegistrationEmail = async (email = "") => {
    const normalized = String(email).trim().toLowerCase()
    const domain = normalized.split("@")[1] || ""

    if (!emailRegex.test(normalized) || normalized.length > 160 || domain.includes("..")) {
        return {
            valid: false,
            code: "INVALID_EMAIL_FORMAT",
            message: "Ingresa un correo válido.",
        }
    }

    if (disposableEmailDomains.has(domain)) {
        return {
            valid: false,
            code: "DISPOSABLE_EMAIL_NOT_ALLOWED",
            message: "No se permiten correos temporales. Usa un correo real.",
        }
    }

    try {
        const mxRecords = await dns.resolveMx(domain)
        if (mxRecords.length > 0) return { valid: true, email: normalized }
    } catch {
        try {
            await dns.resolve4(domain)
            return { valid: true, email: normalized }
        } catch {
            return {
                valid: false,
                code: "EMAIL_DOMAIN_NOT_FOUND",
                message: "El dominio del correo no existe o no puede recibir correos.",
            }
        }
    }

    return {
        valid: false,
        code: "EMAIL_DOMAIN_NOT_FOUND",
        message: "El dominio del correo no existe o no puede recibir correos.",
    }
}
