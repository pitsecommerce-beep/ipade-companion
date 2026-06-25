// Ruta /api/agent — equivalente a la Edge Function de Supabase, ahora en Express/Node.
// Lee Pasaporte + bitácoras + documentos de la jornada y llama a Claude.

import { Router } from "express";
import { createClient } from "@supabase/supabase-js";

const router = Router();

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-opus-4-8";
const MAX_DOC_CHARS = 12_000;
const MAX_TOTAL_DOC_CHARS = 40_000;
const MAX_HISTORY = 16;

interface ReqBody {
  sessionId?: string | null;
  message: string;
  history?: { role: "user" | "assistant"; content: string }[];
}

interface Bitacora { title: string; content: string; updated_at: string }
interface DocRow   { name: string; content_text: string | null }

router.post("/", async (req, res) => {
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) {
    res.status(500).json({ error: "Falta ANTHROPIC_API_KEY en las variables de entorno." });
    return;
  }

  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({ error: "No autorizado." });
    return;
  }

  const body = req.body as ReqBody;
  if (!body.message?.trim()) {
    res.status(400).json({ error: "El mensaje está vacío." });
    return;
  }

  const supabase = createClient(
    process.env.VITE_SUPABASE_URL!,
    process.env.VITE_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: authHeader } } },
  );

  const { data: { user }, error: userErr } = await supabase.auth.getUser();
  if (userErr || !user) {
    res.status(401).json({ error: "Sesión no válida." });
    return;
  }

  const [{ data: passport }, bitacorasRes, documentsRes] = await Promise.all([
    supabase.from("passports").select("*").eq("user_id", user.id).maybeSingle(),
    body.sessionId
      ? supabase
          .from("bitacoras")
          .select("title, content, updated_at")
          .eq("session_id", body.sessionId)
          .order("updated_at", { ascending: false })
      : Promise.resolve({ data: [] as Bitacora[] }),
    body.sessionId
      ? supabase
          .from("documents")
          .select("name, content_text")
          .eq("session_id", body.sessionId)
      : Promise.resolve({ data: [] as DocRow[] }),
  ]);

  const systemPrompt = buildSystemPrompt(
    passport,
    (bitacorasRes.data ?? []) as Bitacora[],
    (documentsRes.data ?? []) as DocRow[],
  );

  const history = (body.history ?? []).slice(-MAX_HISTORY);
  const messages = [
    ...history.map((m) => ({ role: m.role, content: m.content })),
    { role: "user", content: body.message },
  ];

  try {
    const aiRes = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 2048,
        thinking: { type: "adaptive" },
        system: systemPrompt,
        messages,
      }),
    });

    if (!aiRes.ok) {
      const detail = await aiRes.text();
      res.status(502).json({ error: `Error de Claude (${aiRes.status}): ${detail.slice(0, 500)}` });
      return;
    }

    const data = await aiRes.json() as { content?: { type: string; text: string }[] };
    const reply = (data.content ?? [])
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();

    res.json({ reply: reply || "(El agente no devolvió texto.)" });
  } catch (err) {
    res.status(502).json({
      error: `No se pudo contactar a Claude: ${err instanceof Error ? err.message : String(err)}`,
    });
  }
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildSystemPrompt(passport: any, bitacoras: Bitacora[], documents: DocRow[]): string {
  const parts: string[] = [];

  parts.push(
    `Eres "IPADE Companion", un asistente académico institucional para participantes del IPADE Business School.
Tu rol es acompañar al participante en su aprendizaje: resolver dudas sobre los casos y materiales, y ayudarle a pensar y planear iniciativas considerando su contexto profesional y el de su empresa e industria.
Hablas en español, con un tono profesional, claro y cercano, propio de una escuela de negocios. Estructuras tus respuestas y, cuando ayuda a planear, propones pasos concretos. Si te falta información del Pasaporte o de los materiales para responder bien, dilo y pide el dato que necesitas. No inventes datos del caso que no estén en los materiales.`,
  );

  if (passport) {
    const ans = (passport.answers ?? {}) as Record<string, string>;
    parts.push(`--- PASAPORTE DEL PARTICIPANTE ---
Nombre: ${passport.full_name || "(no indicado)"}
Puesto: ${passport.role || "(no indicado)"}
Trayectoria: ${passport.seniority || "(no indicado)"}
Contexto personal / objetivos: ${passport.personal_context || "(no indicado)"}

Empresa: ${passport.company_name || "(no indicado)"}
Industria: ${passport.industry || "(no indicado)"}
Tamaño: ${passport.company_size || "(no indicado)"}
Posición en la industria: ${passport.company_role || "(no indicado)"}
Contexto de la industria: ${passport.industry_context || "(no indicado)"}
Situación de la empresa: ${passport.company_context || "(no indicado)"}
Iniciativas/objetivos en mente: ${passport.objectives || "(no indicado)"}

Prioridad de desarrollo (habilidades/conocimientos): ${ans.dev_priorities || "(no indicado)"}
Iniciativa estratégica prioritaria: ${ans.strategic_initiative || "(no indicado)"}
Mayores obstáculos actuales: ${ans.obstacles || "(no indicado)"}
Contexto adicional para el agente: ${ans.additional_context || "(no indicado)"}`);
  } else {
    parts.push(
      `--- PASAPORTE DEL PARTICIPANTE ---\n(El participante aún no ha completado su Pasaporte. Sugiérele llenarlo para darle mejor acompañamiento.)`,
    );
  }

  if (bitacoras.length > 0) {
    const notes = bitacoras
      .map((b) => {
        try {
          const parsed = JSON.parse(b.content) as Record<string, string>;
          if (parsed && "notes" in parsed) {
            const p: string[] = [`• ${b.title}`];
            if (parsed.notes?.trim())     p.push(`  Notas: ${parsed.notes}`);
            if (parsed.insight?.trim())   p.push(`  Insight clave: ${parsed.insight}`);
            if (parsed.quick_win?.trim()) p.push(`  Quick win declarado: ${parsed.quick_win}`);
            if (parsed.loose_end?.trim()) p.push(`  Duda/inquietud: ${parsed.loose_end}`);
            return p.join("\n");
          }
        } catch { /* texto plano legado */ }
        return `• ${b.title}: ${b.content}`;
      })
      .join("\n")
      .slice(0, 12_000);
    parts.push(`--- BITÁCORAS (NOTAS) DE ESTA JORNADA ---\n${notes}`);
  }

  if (documents.length > 0) {
    let total = 0;
    const chunks: string[] = [];
    for (const d of documents) {
      if (!d.content_text) {
        chunks.push(`[Documento: ${d.name} — sin texto extraído]`);
        continue;
      }
      const remaining = MAX_TOTAL_DOC_CHARS - total;
      if (remaining <= 0) break;
      const text = d.content_text.slice(0, Math.min(MAX_DOC_CHARS, remaining));
      total += text.length;
      chunks.push(`[Documento: ${d.name}]\n${text}`);
    }
    parts.push(`--- MATERIALES DE ESTA JORNADA ---\n${chunks.join("\n\n")}`);
  }

  return parts.join("\n\n");
}

export default router;
