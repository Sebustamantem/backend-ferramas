import nodemailer from "nodemailer"

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

const sendEmail = async ({ to, subject, html }) => {
    const recipients = Array.isArray(to) ? to.filter(Boolean) : [to].filter(Boolean)
    const user = process.env.MAIL_USER
    const pass = process.env.MAIL_PASS
    const from = process.env.MAIL_FROM || user

    if (recipients.length === 0) {
        return { sent: false, skipped: true, reason: "Sin destinatarios" }
    }

    if (!user || !pass || !from) {
        console.log("Correo Ferremas no enviado:", {
            to: recipients,
            subject,
            nota: "Configura MAIL_USER, MAIL_PASS y MAIL_FROM para enviar correos reales.",
        })
        return { sent: false, skipped: true, reason: "Email no configurado" }
    }

    const transporter = nodemailer.createTransport({
        service: "gmail",
        auth: {
            user,
            pass,
        },
    })

    await transporter.sendMail({
        from,
        to: recipients,
        subject,
        html,
    })

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
    return sendEmail({
        to,
        subject: "Recupera tu contrasena FERREMAS",
        html: `
            <div style="font-family: Arial, sans-serif; color: #1f2937; line-height: 1.5;">
                <h2>Recupera tu contrasena</h2>
                <p>Hola ${name || "cliente"}, recibimos una solicitud para cambiar la contrasena de tu cuenta FERREMAS.</p>
                <p>
                    <a href="${resetUrl}" style="display:inline-block;background:#0f766e;color:#ffffff;text-decoration:none;padding:12px 18px;border-radius:10px;font-weight:bold;">
                        Cambiar contrasena
                    </a>
                </p>
                <p>Este enlace vence en 1 hora. Si no solicitaste este cambio, puedes ignorar este correo.</p>
            </div>
        `,
    })
}
