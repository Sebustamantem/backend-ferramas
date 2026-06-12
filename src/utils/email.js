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

const parseSender = (from = "") => {
    const match = String(from).match(/^(.*?)\s*<([^>]+)>$/)
    if (!match) return { email: from }

    return {
        name: match[1].trim(),
        email: match[2].trim(),
    }
}

const getFrontendUrl = () => (process.env.FRONTEND_URL || "https://frontend-ferremas.onrender.com").replace(/\/$/, "")

const getLogoUrl = () => `${getFrontendUrl()}/images/Logo.png`

const sendEmail = async ({ to, subject, html }) => {
    const recipients = Array.isArray(to) ? to.filter(Boolean) : [to].filter(Boolean)
    const from = process.env.MAIL_FROM
    const apiKey = process.env.BREVO_API_KEY

    if (recipients.length === 0) {
        return { sent: false, skipped: true, reason: "Sin destinatarios" }
    }

    if (!apiKey || !from) {
        console.log("Correo Ferremas no enviado:", {
            to: recipients,
            subject,
            nota: "Configura BREVO_API_KEY y MAIL_FROM para enviar correos reales.",
        })
        return { sent: false, skipped: true, reason: "Email no configurado" }
    }

    const response = await fetch("https://api.brevo.com/v3/smtp/email", {
        method: "POST",
        headers: {
            "api-key": apiKey,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            sender: parseSender(from),
            to: recipients.map((email) => ({ email })),
            subject,
            htmlContent: html,
        }),
    })

    if (!response.ok) {
        const detail = await response.text()
        throw new Error(`No se pudo enviar correo Brevo: ${detail}`)
    }

    return { sent: true, skipped: false }
}

export const sendServiceContactEmail = async ({ request, orderId }) => {
    const to = [request.customer_email, request.professional_email].filter(Boolean)
    const subject = `Contacto por asesoria FERREMAS - Pedido #${orderId}`

    return sendEmail({
        to,
        subject,
        html: buildServiceContactHtml({ request }),
    })
}

export const sendPasswordResetEmail = async ({ to, name, resetUrl }) => {
    const logoUrl = getLogoUrl()

    return sendEmail({
        to,
        subject: "Recupera tu contraseña FERREMAS",
        html: `
            <div style="margin:0;padding:0;background:#f3f6f5;font-family:Arial,Helvetica,sans-serif;color:#1f2937;">
                <div style="max-width:560px;margin:0 auto;padding:32px 16px;">
                    <div style="background:#ffffff;border:1px solid #d9e4df;border-radius:16px;overflow:hidden;box-shadow:0 10px 30px rgba(15,23,42,0.08);">
                        <div style="background:#0f766e;padding:24px 28px;text-align:center;">
                            <img src="${logoUrl}" alt="FERREMAS" width="86" style="display:block;margin:0 auto 10px;max-width:86px;height:auto;border:0;" />
                            <div style="font-size:24px;font-weight:800;letter-spacing:1px;color:#ffffff;">FERREMAS</div>
                            <div style="font-size:13px;color:#ccfbf1;margin-top:6px;">Recuperación de cuenta</div>
                        </div>

                        <div style="padding:32px 28px;">
                            <h1 style="margin:0 0 14px;font-size:24px;line-height:1.25;color:#111827;">Crea una nueva contraseña</h1>
                            <p style="margin:0 0 20px;font-size:15px;line-height:1.7;color:#374151;">
                                Hola ${name || "cliente"}, recibimos una solicitud para cambiar la contraseña de tu cuenta FERREMAS.
                            </p>

                            <div style="text-align:center;margin:28px 0;">
                                <a href="${resetUrl}" style="display:inline-block;background:#f97316;color:#ffffff;text-decoration:none;padding:14px 24px;border-radius:10px;font-size:15px;font-weight:700;">
                                    Cambiar contraseña
                                </a>
                            </div>

                            <div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:12px;padding:14px 16px;margin:0 0 20px;">
                                <p style="margin:0;font-size:14px;line-height:1.6;color:#9a3412;">
                                    Este enlace vence en 1 hora. Si no solicitaste este cambio, puedes ignorar este correo.
                                </p>
                            </div>

                            <p style="margin:0;font-size:13px;line-height:1.6;color:#6b7280;">
                                Si el botón no funciona, copia y pega este enlace en tu navegador:<br />
                                <a href="${resetUrl}" style="color:#0f766e;word-break:break-all;">${resetUrl}</a>
                            </p>
                        </div>
                    </div>

                    <p style="margin:18px 0 0;text-align:center;font-size:12px;color:#6b7280;">
                        FERREMAS - Herramientas, construcción y servicios para tu hogar.
                    </p>
                </div>
            </div>
        `,
    })
}
