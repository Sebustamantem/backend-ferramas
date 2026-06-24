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

const formatCurrency = (value = 0) => `$${Number(value || 0).toLocaleString("es-CL")}`

const formatDate = (value) => {
    if (!value) return "Por definir"
    return new Intl.DateTimeFormat("es-CL", { dateStyle: "long" }).format(new Date(value))
}

const orderStatusLabels = {
    pending: "Pendiente de pago",
    transfer_pending: "Transferencia pendiente",
    paid: "Pagado",
    processing: "En preparación",
    shipped: "Despachado",
    delivered: "Entregado",
    cancelled: "Cancelado",
}

const baseEmailHtml = ({ eyebrow, title, children }) => `
    <div style="margin:0;padding:0;background:#f3f6f5;font-family:Arial,Helvetica,sans-serif;color:#1f2937;">
        <div style="max-width:560px;margin:0 auto;padding:32px 16px;">
            <div style="background:#ffffff;border:1px solid #d9e4df;border-radius:16px;overflow:hidden;box-shadow:0 10px 30px rgba(15,23,42,0.08);">
                <div style="background:#0f766e;padding:24px 28px;text-align:center;">
                    <img src="${getLogoUrl()}" alt="FERREMAS" width="86" style="display:block;margin:0 auto 10px;max-width:86px;height:auto;border:0;" />
                    <div style="font-size:24px;font-weight:800;letter-spacing:1px;color:#ffffff;">FERREMAS</div>
                    <div style="font-size:13px;color:#ccfbf1;margin-top:6px;">${eyebrow}</div>
                </div>

                <div style="padding:32px 28px;">
                    <h1 style="margin:0 0 14px;font-size:24px;line-height:1.25;color:#111827;">${title}</h1>
                    ${children}
                </div>
            </div>

            <p style="margin:18px 0 0;text-align:center;font-size:12px;color:#6b7280;">
                FERREMAS - Herramientas, construcción y servicios para tu hogar.
            </p>
        </div>
    </div>
`

const orderItemsHtml = (items = []) => {
    if (!items.length) return ""

    return `
        <div style="margin:20px 0;border-top:1px solid #e5e7eb;">
            ${items.map((item) => `
                <div style="padding:12px 0;border-bottom:1px solid #e5e7eb;">
                    <strong>${item.name || "Producto"}</strong><br />
                    <span style="font-size:13px;color:#6b7280;">
                        Cantidad: ${item.quantity || 1} - Precio: ${formatCurrency(item.price)}
                    </span>
                </div>
            `).join("")}
        </div>
    `
}

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

export const sendWelcomeEmail = async ({ to, name, userType }) => sendEmail({
    to,
    subject: "Bienvenido a FERREMAS",
    html: baseEmailHtml({
        eyebrow: "Cuenta creada",
        title: `Hola ${name || "cliente"}, bienvenido a FERREMAS`,
        children: `
            <p style="margin:0 0 16px;font-size:15px;line-height:1.7;color:#374151;">
                Tu cuenta fue creada correctamente. Ya puedes comprar herramientas, revisar tus pedidos y gestionar tus datos.
            </p>
            ${["maestro_pending", "pyme_pending"].includes(userType) ? `
                <div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:12px;padding:14px 16px;margin-top:18px;">
                    <p style="margin:0;font-size:14px;line-height:1.6;color:#9a3412;">
                        Tu postulación profesional quedó pendiente de revisión. Te avisaremos por correo cuando sea aprobada o rechazada.
                    </p>
                </div>
            ` : ""}
        `,
    }),
})

export const sendOrderConfirmationEmail = async ({ to, name, order, items = [], paymentMethod = "Compra" }) => sendEmail({
    to,
    subject: `Confirmación de compra FERREMAS #${order.id}`,
    html: baseEmailHtml({
        eyebrow: "Confirmación de compra",
        title: `Recibimos tu pedido #${order.id}`,
        children: `
            <p style="margin:0 0 16px;font-size:15px;line-height:1.7;color:#374151;">
                Hola ${name || "cliente"}, tu pedido fue registrado correctamente.
            </p>
            <div style="background:#f8fafc;border:1px solid #e5e7eb;border-radius:12px;padding:14px 16px;">
                <p style="margin:0;font-size:14px;line-height:1.7;color:#374151;">
                    <strong>Estado:</strong> ${orderStatusLabels[order.status] || order.status}<br />
                    <strong>Método:</strong> ${paymentMethod}<br />
                    <strong>Total:</strong> ${formatCurrency(order.total)}
                </p>
            </div>
            ${orderItemsHtml(items)}
        `,
    }),
})

export const sendOrderStatusEmail = async ({ to, name, order, status }) => sendEmail({
    to,
    subject: `Actualización de pedido FERREMAS #${order.id}`,
    html: baseEmailHtml({
        eyebrow: "Estado de pedido",
        title: `Tu pedido #${order.id} está ${orderStatusLabels[status] || status}`,
        children: `
            <p style="margin:0 0 16px;font-size:15px;line-height:1.7;color:#374151;">
                Hola ${name || "cliente"}, actualizamos el estado de tu pedido.
            </p>
            <div style="background:#f8fafc;border:1px solid #e5e7eb;border-radius:12px;padding:14px 16px;">
                <p style="margin:0;font-size:14px;line-height:1.7;color:#374151;">
                    <strong>Pedido:</strong> #${order.id}<br />
                    <strong>Estado actual:</strong> ${orderStatusLabels[status] || status}<br />
                    <strong>Total:</strong> ${formatCurrency(order.total)}
                </p>
            </div>
        `,
    }),
})

export const sendFerreCreditStatusEmail = async ({ to, name, approved, creditLimit = 0 }) => sendEmail({
    to,
    subject: approved ? "Tu FerreCrédito fue aprobado" : "Tu postulación FerreCrédito fue rechazada",
    html: baseEmailHtml({
        eyebrow: "FerreCrédito",
        title: approved ? "FerreCrédito aprobado" : "Postulación rechazada",
        children: approved ? `
            <p style="margin:0 0 16px;font-size:15px;line-height:1.7;color:#374151;">
                Hola ${name || "cliente"}, tu línea FerreCrédito fue aprobada.
            </p>
            <div style="background:#ecfdf5;border:1px solid #99f6e4;border-radius:12px;padding:14px 16px;">
                <p style="margin:0;font-size:14px;line-height:1.7;color:#115e59;">
                    <strong>Cupo aprobado:</strong> ${formatCurrency(creditLimit)}<br />
                    Ya puedes usarlo en el checkout si tienes cupo disponible.
                </p>
            </div>
        ` : `
            <p style="margin:0 0 16px;font-size:15px;line-height:1.7;color:#374151;">
                Hola ${name || "cliente"}, revisamos tu postulación FerreCrédito y por ahora no fue aprobada.
            </p>
            <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:12px;padding:14px 16px;">
                <p style="margin:0;font-size:14px;line-height:1.7;color:#991b1b;">
                    Si necesitas más información, puedes contactar al equipo FERREMAS.
                </p>
            </div>
        `,
    }),
})

export const sendUpcomingInstallmentEmail = async ({ to, name, installment }) => sendEmail({
    to,
    subject: `Próxima cuota FerreCrédito - Pedido #${installment.order_id}`,
    html: baseEmailHtml({
        eyebrow: "Próxima cuota",
        title: "Tienes una próxima cuota FerreCrédito",
        children: `
            <p style="margin:0 0 16px;font-size:15px;line-height:1.7;color:#374151;">
                Hola ${name || "cliente"}, te dejamos el detalle de tu próxima cuota.
            </p>
            <div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:12px;padding:14px 16px;">
                <p style="margin:0;font-size:14px;line-height:1.7;color:#9a3412;">
                    <strong>Pedido:</strong> #${installment.order_id}<br />
                    <strong>Cuota:</strong> ${Number(installment.paid_installments || 0) + 1} de ${installment.installments}<br />
                    <strong>Monto:</strong> ${formatCurrency(installment.amount_per_installment)}<br />
                    <strong>Vence:</strong> ${formatDate(installment.due_date)}
                </p>
            </div>
        `,
    }),
})

export const sendPasswordResetEmail = async ({ to, name, resetUrl, expiresInMinutes = 30 }) => {
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
                                    Este enlace vence en ${expiresInMinutes} minutos. Si no solicitaste este cambio, puedes ignorar este correo.
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
