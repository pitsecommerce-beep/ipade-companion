// Ruta /api/generate-report — clasifica iniciativas del participante con Claude
// y las persiste en initiative_reports + initiatives.

import { Router } from "express";
import { createUserClient } from "../lib/supabase.js";

const router = Router();
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-sonnet-4-6";

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

router.post("/", async (req, res) => {
  try {
    const anthropicKey = process.env.ANTHROPIC_API_KEY;
    if (!anthropicKey) {
      res.status(500).json({ error: "Falta ANTHROPIC_API_KEY en las variables de entorno de Railway." });
      return;
    }

    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      res.status(401).json({ error: "No autorizado." });
      return;
    }

    const supabase = createUserClient(authHeader);

    const { data: { user }, error: userErr } = await supabase.auth.getUser();
    if (userErr || !user) {
      res.status(401).json({ error: "Sesión no válida." });
      return;
    }

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
    if (!passport) {
      res.status(422).json({
        error: "Completa tu Pasaporte IPADE primero para que el agente pueda generar el Plan de Acción.",
      });
      return;
    }

    const bitacoras = (bitacorasRes.data ?? []) as Array<{
      title: string; content: string; updated_at: string;
    }>;

    // Extraer quick wins y reflexiones de las bitácoras
    const bitacoraInsights: string[] = [];
    for (const b of bitacoras) {
      try {
        const parsed = JSON.parse(b.content) as Record<string, string>;
        if (parsed && typeof parsed === "object") {
          const parts = [`Bitácora: "${b.title}"`];
          if (parsed.quick_win?.trim()) parts.push(`  Quick win declarado: ${parsed.quick_win}`);
          if (parsed.insight?.trim())   parts.push(`  Insight clave: ${parsed.insight}`);
          if (parsed.loose_end?.trim()) parts.push(`  Duda/inquietud: ${parsed.loose_end}`);
          if (parts.length > 1) bitacoraInsights.push(parts.join("\n"));
        }
      } catch {
        if (b.content?.trim()) {
          bitacoraInsights.push(`Bitácora "${b.title}": ${b.content.slice(0, 400)}`);
        }
      }
    }

    const ans = (passport.answers ?? {}) as Record<string, string>;
    const firstName = ((passport.full_name as string) || "participante").split(" ")[0];

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
Iniciativa estratégica prioritaria en su rol: ${ans.strategic_initiative || "(no indicado)"}
Prioridad de desarrollo (habilidades y conocimientos): ${ans.dev_priorities || "(no indicado)"}
Mayores obstáculos actuales: ${ans.obstacles || "(no indicado)"}
Contexto adicional: ${ans.additional_context || "(no indicado)"}

${bitacoraInsights.length > 0
  ? `QUICK WINS Y REFLEXIONES DE LAS JORNADAS\n${bitacoraInsights.join("\n\n")}`
  : "(El participante aún no tiene bitácoras con quick wins registrados.)"
}`.trim();

    const systemPrompt = `Eres IPADE Companion, asistente académico institucional del IPADE Business School.
Tu tono es profesional, cálido y motivador. Nunca generas ansiedad: separas claramente las categorías
para que el participante vea un camino ordenado, no una lista abrumadora. Siempre escribes en español.`;

    const userPrompt = `Con base en la siguiente información del participante, extrae y clasifica TODAS las iniciativas que ha mencionado querer implementar.

${participantContext}

INSTRUCCIONES DE CLASIFICACIÓN:
- INICIATIVAS INMEDIATAS: Acciones concretas implementables en semanas, con pocos recursos, ejecutables de forma personal o con el equipo inmediato.
- PORTAFOLIO DE INICIATIVAS: Proyectos que requieren meses de implementación, alineación de múltiples áreas, presupuesto o un cambio cultural/organizacional.

TONO: El reporte debe motivar, no abrumar. Ambas categorías son igualmente valiosas: son horizontes distintos, no prioridades distintas.

Para los correos de recordatorio escríbelos cálidos, breves (máx 5 oraciones), en primera persona del asistente, terminando con un mensaje motivador.

Responde ÚNICAMENTE con JSON válido (sin texto antes ni después):
{
  "report_markdown": "reporte en markdown con ## encabezados separando claramente las dos categorías",
  "initiatives": [
    {
      "title": "nombre corto (máx 8 palabras)",
      "description": "descripción motivadora en 2-3 oraciones",
      "category": "inmediata",
      "source": "passport",
      "email_subject": "Recordatorio: [nombre]",
      "email_body": "Hola ${firstName}, ..."
    }
  ]
}`;

    console.log(`[generate-report] Llamando a Claude para user ${user.id}`);

    const aiRes = await fetch(ANTHROPIC_URL, {
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

    if (!aiRes.ok) {
      const detail = await aiRes.text();
      console.error(`[generate-report] Claude error ${aiRes.status}:`, detail.slice(0, 500));
      res.status(502).json({
        error: `Error al llamar a Claude (${aiRes.status}). Verifica que ANTHROPIC_API_KEY sea válida y que el modelo esté disponible.`,
      });
      return;
    }

    const aiData = await aiRes.json() as { content?: { type: string; text: string }[] };
    const rawText = (aiData.content ?? [])
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();

    console.log(`[generate-report] Respuesta de Claude recibida (${rawText.length} chars)`);

    let parsed: ClaudeResponse;
    try {
      const jsonMatch = rawText.match(/```json\s*([\s\S]+?)\s*```/) ?? rawText.match(/(\{[\s\S]+\})/);
      parsed = JSON.parse(jsonMatch ? jsonMatch[1] : rawText) as ClaudeResponse;
    } catch (parseErr) {
      console.error("[generate-report] JSON parse error:", parseErr, "raw:", rawText.slice(0, 300));
      res.status(502).json({ error: "El agente no devolvió JSON válido. Intenta de nuevo." });
      return;
    }

    const { data: reportRow, error: reportErr } = await supabase
      .from("initiative_reports")
      .insert({ user_id: user.id, content: parsed.report_markdown })
      .select("id")
      .single();

    if (reportErr || !reportRow) {
      console.error("[generate-report] DB error saving report:", reportErr);
      res.status(500).json({ error: `Error guardando reporte: ${reportErr?.message ?? "desconocido"}` });
      return;
    }

    const reportId = (reportRow as { id: string }).id;

    if (parsed.initiatives?.length > 0) {
      const rows = parsed.initiatives.map((i) => ({
        user_id: user.id,
        report_id: reportId,
        title: i.title,
        description: i.description,
        category: i.category === "inmediata" ? "inmediata" : "portafolio",
        source: i.source === "bitacora" ? "bitacora" : "passport",
        email_subject: i.email_subject ?? "",
        email_body: i.email_body ?? "",
      }));

      const { error: initErr } = await supabase.from("initiatives").insert(rows);
      if (initErr) {
        console.error("[generate-report] DB error saving initiatives:", initErr);
        res.status(500).json({ error: `Error guardando iniciativas: ${initErr.message}` });
        return;
      }
    }

    const { data: initiatives } = await supabase
      .from("initiatives")
      .select("*")
      .eq("report_id", reportId)
      .order("category");

    console.log(`[generate-report] OK — ${initiatives?.length ?? 0} iniciativas guardadas`);

    res.json({
      report: { id: reportId, content: parsed.report_markdown },
      initiatives: initiatives ?? [],
    });

  } catch (err) {
    console.error("[generate-report] Unhandled error:", err);
    res.status(500).json({
      error: `Error inesperado: ${err instanceof Error ? err.message : String(err)}`,
    });
  }
});

export default router;
