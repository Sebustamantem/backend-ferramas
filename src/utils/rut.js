export const cleanRut = (value = "") =>
    String(value).replace(/[^0-9kK]/g, "").slice(0, 9)

export const formatRut = (value = "") => {
    const clean = cleanRut(value)
    if (clean.length <= 1) return clean

    const body = clean.slice(0, -1)
    const dv = clean.slice(-1).toUpperCase()
    const formattedBody = body.replace(/\B(?=(\d{3})+(?!\d))/g, ".")
    return `${formattedBody}-${dv}`
}

export const isRutLengthValid = (value = "") => {
    const clean = cleanRut(value)
    return clean.length >= 8 && clean.length <= 9
}
