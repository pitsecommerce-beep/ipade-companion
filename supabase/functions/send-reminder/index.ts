// IPADE Companion — Edge Function "send-reminder"
//
// Envía un correo de recordatorio de iniciativa vía Resend.
// Requiere:   supabase secrets set RESEND_API_KEY=re_...
// Despliegue: supabase functions deploy send-reminder
//
// Body esperado: { reminderId: string }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const RESEND_URL = "https://api.resend.com/emails";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function emailHtml(body: string): string {
  const lines = body
    .split("\n")
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);

  const resendKey = Deno.env.get("RESEND_API_KEY");
  if (!resendKey) {
    return json({
      error: "Falta RESEND_API_KEY en los secrets. Configúrala con: supabase secrets set RESEND_API_KEY=re_...",
    }, 500);
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "No autorizado." }, 401);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );

  const { data: { user }, error: userErr } = await supabase.auth.getUser();
  if (userErr || !user) return json({ error: "Sesión no válida." }, 401);

  let body: { reminderId: string };
  try { body = await req.json(); } catch {
    return json({ error: "Cuerpo inválido." }, 400);
  }
  if (!body.reminderId) return json({ error: "Falta reminderId." }, 400);

  // Cargar el recordatorio (RLS garantiza que sólo ve el suyo)
  const { data: reminder, error: remErr } = await supabase
    .from("email_reminders")
    .select("*")
    .eq("id", body.reminderId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (remErr || !reminder) {
    return json({ error: "Recordatorio no encontrado." }, 404);
  }
  if (reminder.status === "enviado") {
    return json({ error: "Este recordatorio ya fue enviado." }, 409);
  }

  // Enviar vía Resend
  const fromEmail = Deno.env.get("RESEND_FROM_EMAIL") ?? "IPADE Companion <noreply@ipade-companion.app>";

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
      html: emailHtml(reminder.body),
      text: reminder.body,
    }),
  });

  const resendBody = await resendRes.json();

  if (!resendRes.ok) {
    // Registrar el fallo
    await supabase
      .from("email_reminders")
      .update({ status: "fallido", error_msg: JSON.stringify(resendBody) })
      .eq("id", reminder.id);

    return json({ error: `Resend devolvió error: ${JSON.stringify(resendBody)}` }, 502);
  }

  // Marcar como enviado
  await supabase
    .from("email_reminders")
    .update({ status: "enviado", sent_at: new Date().toISOString() })
    .eq("id", reminder.id);

  return json({ ok: true, messageId: resendBody.id });
});
