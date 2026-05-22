const buildServiceContactHtml = ({ request }) => `
    <div style="font-family: Arial, sans-serif; color: #1f2937; line-height: 1.5;">
        <h2>Contacto por asesoria FERREMAS</h2>
        <p>Se confirmo el pago de contacto por $${Number(request.amount || 5000).toLocaleString("es-CL")}.</p>
        <h3>Cliente</h3>
        <p>
            <strong>${request.customer_name || "Cliente"}</strong><br />
            ${request.customer_email || ""}<br />
            ${request.customer_phone || ""}
        </p>
        <h3>Maestro/PYME</h3>
        <p>
            <strong>${request.professional_name || "Profesional"}</strong><br />
            ${request.professional_email || ""}<br />
            ${request.professional_phone || ""}
        </p>
        <p>
            FERREMAS solo cobra esta confirmacion de contacto. El valor, alcance y pago del
            servicio final se acuerdan directamente entre cliente y maestro/PYME.
        </p>
    </div>
`

export const sendServiceContactEmail = async ({ request, orderId }) => {
    const to = [request.customer_email, request.professional_email].filter(Boolean)
    const from = process.env.MAIL_FROM
    const apiKey = process.env.RESEND_API_KEY
    const subject = `Contacto por asesoria FERREMAS - Pedido #${orderId}`

    if (to.length === 0) {
        return { sent: false, skipped: true, reason: "Sin destinatarios" }
    }

    if (!apiKey || !from) {
        console.log("Correo mixto servicio Ferremas:", {
            to,
            subject,
            cliente: {
                nombre: request.customer_name,
                email: request.customer_email,
                telefono: request.customer_phone,
            },
            profesional: {
                nombre: request.professional_name,
                email: request.professional_email,
                telefono: request.professional_phone,
            },
            nota: "Configura RESEND_API_KEY y MAIL_FROM para enviar correos reales.",
        })
        return { sent: false, skipped: true, reason: "Email no configurado" }
    }

    const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            from,
            to,
            subject,
            html: buildServiceContactHtml({ request }),
        }),
    })

    if (!response.ok) {
        const detail = await response.text()
        throw new Error(`No se pudo enviar correo mixto: ${detail}`)
    }

    return { sent: true, skipped: false }
}
