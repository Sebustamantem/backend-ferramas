const sequentialPatterns = [
    "0123456789",
    "9876543210",
    "abcdefghijklmnopqrstuvwxyz",
    "zyxwvutsrqponmlkjihgfedcba",
    "qwertyuiop",
    "poiuytrewq",
]

const normalize = (value = "") =>
    String(value)
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")

const normalizeRut = (rut = "") => String(rut).replace(/[^0-9kK]/g, "").toLowerCase()

const hasSequence = (password) => {
    const value = normalize(password)
    return sequentialPatterns.some((pattern) => {
        for (let index = 0; index <= pattern.length - 4; index += 1) {
            if (value.includes(pattern.slice(index, index + 4))) return true
        }
        return false
    })
}

export const validateStrongPassword = (password = "", user = {}) => {
    const value = String(password)
    const normalized = normalize(value)
    const rut = normalizeRut(user.rut)

    if (value.length < 12) {
        return { valid: false, code: "PASSWORD_TOO_SHORT", message: "La contraseña debe tener al menos 12 caracteres." }
    }
    if (value.length > 72) {
        return { valid: false, code: "PASSWORD_TOO_LONG", message: "La contraseña no puede superar 72 caracteres." }
    }
    if (/\s/.test(value)) {
        return { valid: false, code: "PASSWORD_HAS_SPACES", message: "La contraseña no puede tener espacios." }
    }
    if (!/[A-Z]/.test(value)) {
        return { valid: false, code: "PASSWORD_NEEDS_UPPERCASE", message: "Debe tener al menos una mayúscula." }
    }
    if (!/[a-z]/.test(value)) {
        return { valid: false, code: "PASSWORD_NEEDS_LOWERCASE", message: "Debe tener al menos una minúscula." }
    }
    if (!/[0-9]/.test(value)) {
        return { valid: false, code: "PASSWORD_NEEDS_NUMBER", message: "Debe tener al menos un número." }
    }
    if (!/[!@#$%^&*._-]/.test(value)) {
        return { valid: false, code: "PASSWORD_NEEDS_SYMBOL", message: "Debe tener al menos un símbolo permitido: ! @ # $ % ^ & * . _ -" }
    }
    if (/[^A-Za-z0-9!@#$%^&*._-]/.test(value)) {
        return { valid: false, code: "PASSWORD_INVALID_CHARACTERS", message: "Usa solo letras, números y estos símbolos: ! @ # $ % ^ & * . _ -" }
    }
    if (/(.)\1{2,}/.test(value)) {
        return { valid: false, code: "PASSWORD_REPEATED_CHARS", message: "No uses el mismo carácter 3 veces seguidas." }
    }
    if (hasSequence(value)) {
        return { valid: false, code: "PASSWORD_HAS_SEQUENCE", message: "No uses secuencias como 1234, 9876, abcd o qwerty." }
    }
    if (rut && normalized.includes(rut.slice(0, -1))) {
        return { valid: false, code: "PASSWORD_CONTAINS_RUT", message: "La contraseña no puede contener tu RUT." }
    }

    const personalValues = [user.name, user.lastname, user.email?.split("@")[0]]
        .map(normalize)
        .filter((item) => item.length >= 4)

    if (personalValues.some((item) => normalized.includes(item))) {
        return { valid: false, code: "PASSWORD_CONTAINS_PERSONAL_DATA", message: "La contraseña no puede contener tu nombre, apellido o correo." }
    }

    return { valid: true }
}
