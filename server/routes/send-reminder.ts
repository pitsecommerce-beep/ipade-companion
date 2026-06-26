// Ruta /api/send-reminder — envía correo de recordatorio vía Resend.
// Requiere RESEND_API_KEY en las variables de entorno de Railway.

import { Router } from "express";
import { createUserClient } from "../lib/supabase.js";

const router = Router();
const RESEND_URL = "https://api.resend.com/emails";

function emailHtml(body: string): string {
  const lines = body
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => `<p style="margin:0 0 12px;line-height:1.6">${l}</p>`)
    .join("");
  return `<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:'Segoe UI',Arial,sans-serif;background:#f4f6fa;padding:32px 16px;margin:0">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:10px;
              border-top:4px solid #c8a55b;padding:32px 28px;box-shadow:0 2px 12px rgba(0,40,85,.08)">
    <div style="margin-bottom:24px">
      <img src="https://www.ipade.mx/wp-content/uploads/2022/10/fav.png?w=80"
           width="40" height="40" alt="IPADE"
           style="border-radius:8px;background:#002855;padding:4px">
    </div>
    ${lines}
    <hr style="border:none;border-top:1px solid #d8dee8;margin:24px 0">
    <p style="font-size:12px;color:#5b6676;margin:0">
      IPADE Companion · Herramienta de acompañamiento para participantes del IPADE Business School.<br>
      Este correo fue generado a tu solicitud desde la plataforma.
    </p>
  </div>
</body>
</html>`;
}

router.post("/", async (req, res) => {
  try {
  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) {
    res.status(503).json({
      error: "El envío de correos no está habilitado en este entorno. Configura RESEND_API_KEY en las variables de Railway para activarlo.",
    });
    return;
  }

  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({ error: "No autorizado." });
    return;
  }

  const supabase = createUserClient(authHeader);

  const { data: { user }, error: userErr } = await supabase.auth.getUser();
  if (userErr || !user) { res.status(401).json({ error: "Sesión no válida." }); return; }

  const { reminderId } = req.body as { reminderId?: string };
  if (!reminderId) { res.status(400).json({ error: "Falta reminderId." }); return; }

  const { data: reminder, error: remErr } = await supabase
    .from("email_reminders")
    .select("*")
    .eq("id", reminderId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (remErr || !reminder) { res.status(404).json({ error: "Recordatorio no encontrado." }); return; }
  if (reminder.status === "enviado") { res.status(409).json({ error: "Ya fue enviado." }); return; }

  // Por defecto usamos el remitente compartido de Resend, que funciona sin
  // verificar un dominio propio. Para producción, configura RESEND_FROM_EMAIL
  // con un dominio verificado en Resend (ej. "IPADE Companion <no-reply@tudominio.com>").
  const fromEmail = process.env.RESEND_FROM_EMAIL ?? "IPADE Companion <onboarding@resend.dev>";

  const resendRes = await fetch(RESEND_URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${resendKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: fromEmail,
      to: [reminder.email_to],
      subject: reminder.subject,
      html: emailHtml(String(reminder.body)),
      text: String(reminder.body),
    }),
  });

  const resendBody = await resendRes.json().catch(() => ({})) as { id?: string; message?: string };

  if (!resendRes.ok) {
    const detail = resendBody.message ?? JSON.stringify(resendBody);
    console.error(`[send-reminder] Resend error ${resendRes.status}:`, detail);

    // Mensajes accionables según la causa más común.
    let friendly: string;
    if (resendRes.status === 401 || resendRes.status === 403) {
      friendly =
        "No se pudo enviar el correo: la RESEND_API_KEY es inválida o el dominio remitente no está verificado en Resend. " +
        "Verifica un dominio en Resend y configúralo en RESEND_FROM_EMAIL, o usa el remitente de prueba onboarding@resend.dev. " +
        `(Detalle: ${detail})`;
    } else if (resendRes.status === 422) {
      friendly = `El correo fue rechazado por datos inválidos (remitente o destinatario). Detalle: ${detail}`;
    } else {
      friendly = `No se pudo enviar el correo (Resend ${resendRes.status}). Detalle: ${detail}`;
    }

    await supabase
      .from("email_reminders")
      .update({ status: "fallido", error_msg: detail })
      .eq("id", reminder.id);
    res.status(502).json({ error: friendly });
    return;
  }

  await supabase
    .from("email_reminders")
    .update({ status: "enviado", sent_at: new Date().toISOString() })
    .eq("id", reminder.id);

  res.json({ ok: true, messageId: resendBody.id });
  } catch (err) {
    console.error("[send-reminder] Unhandled error:", err);
    res.status(500).json({
      error: `Error inesperado: ${err instanceof Error ? err.message : String(err)}`,
    });
  }
});

export default router;
