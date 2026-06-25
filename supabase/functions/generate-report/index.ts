// IPADE Companion — Edge Function "generate-report"
//
// Reúne TODO el contexto del participante (Pasaporte + respuestas extendidas +
// quick-wins de todas las bitácoras) y pide a Claude que clasifique las
// iniciativas en Inmediatas o Portafolio, generando también un borrador de
// correo recordatorio para cada una.
//
// Despliegue:
//   supabase functions deploy generate-report
//   supabase secrets set ANTHROPIC_API_KEY=sk-ant-...

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-sonnet-4-6";

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

interface InitiativeItem {
  title: string;
  description: string;
  category: "inmediata" | "portafolio";
  source: "passport" | "bitacora";
  email_subject: string;
  email_body: string;
}

interface ClaudeResponse {
  report_markdown: string;
  initiatives: InitiativeItem[];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);

  const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!anthropicKey) {
    return json({ error: "Falta ANTHROPIC_API_KEY en los secrets." }, 500);
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

  // --- Reunir todo el contexto del participante ---
  const [passportRes, bitacorasRes] = await Promise.all([
    supabase.from("passports").select("*").eq("user_id", user.id).maybeSingle(),
    supabase
      .from("bitacoras")
      .select("title, content, updated_at")
      .eq("user_id", user.id)
      .order("updated_at", { ascending: false })
      .limit(100),
  ]);

  const passport = passportRes.data;
  const bitacoras = (bitacorasRes.data ?? []) as Array<{
    title: string; content: string; updated_at: string;
  }>;

  if (!passport) {
    return json({
      error: "El participante no ha completado su Pasaporte. Complétalo primero para generar el Plan de Acción.",
    }, 422);
  }

  // Extraer quick wins y reflexiones de las bitácoras (formato JSON nuevo)
  const bitacoraInsights: string[] = [];
  for (const b of bitacoras) {
    try {
      const parsed = JSON.parse(b.content);
      if (parsed && typeof parsed === "object") {
        const parts: string[] = [`Bitácora: "${b.title}"`];
        if (parsed.quick_win?.trim()) parts.push(`  Quick win declarado: ${parsed.quick_win}`);
        if (parsed.insight?.trim()) parts.push(`  Insight clave: ${parsed.insight}`);
        if (parsed.loose_end?.trim()) parts.push(`  Duda/inquietud: ${parsed.loose_end}`);
        if (parts.length > 1) bitacoraInsights.push(parts.join("\n"));
      }
    } catch {
      if (b.content?.trim()) {
        bitacoraInsights.push(`Bitácora "${b.title}": ${b.content.slice(0, 400)}`);
      }
    }
  }

  const answers = (passport.answers ?? {}) as Record<string, string>;

  const participantContext = `
DATOS DEL PARTICIPANTE
Nombre: ${passport.full_name || "(no indicado)"}
Puesto: ${passport.role || "(no indicado)"}
Empresa: ${passport.company_name || "(no indicado)"}
Industria: ${passport.industry || "(no indicado)"}
Trayectoria: ${passport.seniority || "(no indicado)"}

CONTEXTO PERSONAL Y DE EMPRESA
Motivaciones / Por qué viene al IPADE: ${passport.personal_context || "(no indicado)"}
Situación de la empresa: ${passport.company_context || "(no indicado)"}
Contexto de la industria: ${passport.industry_context || "(no indicado)"}

INICIATIVAS DECLARADAS EN EL PASAPORTE
Iniciativas u objetivos en mente: ${passport.objectives || "(no indicado)"}
Iniciativa estratégica prioritaria en su rol: ${answers.strategic_initiative || "(no indicado)"}
Prioridad de desarrollo (habilidades y conocimientos): ${answers.dev_priorities || "(no indicado)"}
Mayores obstáculos actuales: ${answers.obstacles || "(no indicado)"}
Contexto adicional: ${answers.additional_context || "(no indicado)"}

${bitacoraInsights.length > 0
  ? `QUICK WINS Y REFLEXIONES DE LAS JORNADAS\n${bitacoraInsights.join("\n\n")}`
  : "(El participante aún no tiene bitácoras con quick wins registrados.)"
}
`.trim();

  const systemPrompt = `Eres IPADE Companion, asistente académico institucional del IPADE Business School.
Tu tono es profesional, cálido y motivador. Nunca generas ansiedad: separas claramente las categorías para que el participante vea un camino ordenado, no una lista abrumadora.
Siempre escribes en español.`;

  const userPrompt = `Con base en la siguiente información del participante, extrae y clasifica TODAS las iniciativas que ha mencionado querer implementar.

${participantContext}

INSTRUCCIONES DE CLASIFICACIÓN:
- INICIATIVAS INMEDIATAS: Acciones concretas implementables en semanas, con pocos recursos, ejecutables de forma personal o con el equipo inmediato.
- PORTAFOLIO DE INICIATIVAS: Proyectos que requieren meses de implementación, alineación de múltiples áreas, presupuesto o un cambio cultural/organizacional.

TONO:
- El reporte debe motivar, no abrumar. Usa lenguaje positivo y ordenado.
- Menciona que tanto las Iniciativas Inmediatas como el Portafolio son importantes; son distintos horizontes temporales, no distintos niveles de valor.
- No uses más de 3 puntos por iniciativa. Sé concreto y accionable.

Para los correos de recordatorio:
- Escríbelos en primera persona del asistente ("Hola [nombre], te escribo para recordarte...")
- Deben ser cálidos, breves (máx 5 oraciones) y terminar con un mensaje motivador.
- El asunto debe ser claro y accionable (ej. "Recordatorio: [iniciativa]")

Responde ÚNICAMENTE con JSON válido con esta estructura exacta (sin texto adicional antes ni después):
{
  "report_markdown": "reporte completo en markdown con encabezados ## y bullet points, separando claramente las dos categorías",
  "initiatives": [
    {
      "title": "nombre corto de la iniciativa (máx 8 palabras)",
      "description": "descripción clara y motivadora en 2-3 oraciones",
      "category": "inmediata",
      "source": "passport",
      "email_subject": "Recordatorio: [nombre de la iniciativa]",
      "email_body": "Hola ${passport.full_name?.split(" ")[0] || "participante"}, ..."
    }
  ]
}`;

  try {
    const res = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 4096,
        system: systemPrompt,
        messages: [{ role: "user", content: userPrompt }],
      }),
    });

    if (!res.ok) {
      const detail = await res.text();
      return json({ error: `Error Claude (${res.status}): ${detail.slice(0, 400)}` }, 502);
    }

    const aiData = await res.json();
    const rawText = (aiData.content ?? [])
      .filter((b: { type: string }) => b.type === "text")
      .map((b: { text: string }) => b.text)
      .join("")
      .trim();

    let parsed: ClaudeResponse;
    try {
      // Extraer JSON aunque venga envuelto en ```json ... ```
      const jsonMatch = rawText.match(/```json\s*([\s\S]+?)\s*```/) ??
                        rawText.match(/(\{[\s\S]+\})/);
      parsed = JSON.parse(jsonMatch ? jsonMatch[1] : rawText);
    } catch {
      return json({ error: "El agente no devolvió JSON válido. Intenta de nuevo." }, 502);
    }

    // Persistir el reporte
    const { data: reportRow, error: reportErr } = await supabase
      .from("initiative_reports")
      .insert({ user_id: user.id, content: parsed.report_markdown })
      .select("id")
      .single();

    if (reportErr || !reportRow) {
      return json({ error: `Error guardando reporte: ${reportErr?.message}` }, 500);
    }

    // Persistir cada iniciativa
    if (parsed.initiatives?.length > 0) {
      const rows = parsed.initiatives.map((i) => ({
        user_id: user.id,
        report_id: reportRow.id,
        title: i.title,
        description: i.description,
        category: i.category === "inmediata" ? "inmediata" : "portafolio",
        source: i.source === "bitacora" ? "bitacora" : "passport",
        email_subject: i.email_subject ?? "",
        email_body: i.email_body ?? "",
      }));

      const { error: initErr } = await supabase.from("initiatives").insert(rows);
      if (initErr) {
        return json({ error: `Error guardando iniciativas: ${initErr.message}` }, 500);
      }
    }

    // Devolver reporte completo con iniciativas
    const { data: initiatives } = await supabase
      .from("initiatives")
      .select("*")
      .eq("report_id", reportRow.id)
      .order("category");

    return json({
      report: { id: reportRow.id, content: parsed.report_markdown },
      initiatives: initiatives ?? [],
    });
  } catch (err) {
    return json(
      { error: `Error interno: ${err instanceof Error ? err.message : err}` },
      502,
    );
  }
});
