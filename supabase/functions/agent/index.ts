// IPADE Companion — Edge Function "agent"
//
// Esta función es el único lugar donde vive la ANTHROPIC_API_KEY (como secret
// de Supabase). El frontend estático nunca la ve. La función:
//   1. Usa el JWT del participante para leer (respetando RLS) su Pasaporte,
//      sus bitácoras y el texto de los documentos de la sesión.
//   2. Arma el contexto y llama a la API de Claude (Anthropic).
//   3. Devuelve { reply }.
//
// Despliegue:
//   supabase functions deploy agent
//   supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
//
// SUPABASE_URL y SUPABASE_ANON_KEY se inyectan automáticamente en el runtime.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-opus-4-8";

// Límites defensivos para acotar tokens de contexto.
const MAX_DOC_CHARS = 12_000; // por documento
const MAX_TOTAL_DOC_CHARS = 40_000; // suma de documentos
const MAX_HISTORY = 16; // mensajes previos que reenviamos

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface ReqBody {
  sessionId: string | null;
  message: string;
  history?: { role: "user" | "assistant"; content: string }[];
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "Método no permitido" }, 405);
  }

  const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!anthropicKey) {
    return json(
      { error: "Falta configurar ANTHROPIC_API_KEY en los secrets de la función." },
      500,
    );
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return json({ error: "No autorizado." }, 401);
  }

  let body: ReqBody;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Cuerpo inválido." }, 400);
  }
  if (!body.message?.trim()) {
    return json({ error: "El mensaje está vacío." }, 400);
  }

  // Cliente con el JWT del participante → RLS garantiza que sólo lee sus datos.
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );

  const {
    data: { user },
    error: userErr,
  } = await supabase.auth.getUser();
  if (userErr || !user) {
    return json({ error: "Sesión no válida." }, 401);
  }

  // --- Reunir contexto ---
  const [{ data: passport }, bitacorasRes, documentsRes] = await Promise.all([
    supabase.from("passports").select("*").eq("user_id", user.id).maybeSingle(),
    body.sessionId
      ? supabase
          .from("bitacoras")
          .select("title, content, updated_at")
          .eq("session_id", body.sessionId)
          .order("updated_at", { ascending: false })
      : Promise.resolve({ data: [] }),
    body.sessionId
      ? supabase
          .from("documents")
          .select("name, content_text")
          .eq("session_id", body.sessionId)
      : Promise.resolve({ data: [] }),
  ]);

  const systemPrompt = buildSystemPrompt(
    passport,
    (bitacorasRes.data ?? []) as Bitacora[],
    (documentsRes.data ?? []) as DocRow[],
  );

  // --- Construir mensajes para Claude ---
  const history = (body.history ?? []).slice(-MAX_HISTORY);
  const messages = [
    ...history.map((m) => ({ role: m.role, content: m.content })),
    { role: "user", content: body.message },
  ];

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
        max_tokens: 2048,
        thinking: { type: "adaptive" },
        system: systemPrompt,
        messages,
      }),
    });

    if (!res.ok) {
      const detail = await res.text();
      return json(
        { error: `Error de la API de Claude (${res.status}): ${detail.slice(0, 500)}` },
        502,
      );
    }

    const data = await res.json();
    const reply = (data.content ?? [])
      .filter((b: { type: string }) => b.type === "text")
      .map((b: { text: string }) => b.text)
      .join("\n")
      .trim();

    return json({ reply: reply || "(El agente no devolvió texto.)" });
  } catch (err) {
    return json(
      { error: `No se pudo contactar a Claude: ${err instanceof Error ? err.message : err}` },
      502,
    );
  }
});

interface Bitacora {
  title: string;
  content: string;
  updated_at: string;
}
interface DocRow {
  name: string;
  content_text: string | null;
}

// deno-lint-ignore no-explicit-any
function buildSystemPrompt(passport: any, bitacoras: Bitacora[], documents: DocRow[]): string {
  const parts: string[] = [];

  parts.push(
    `Eres "IPADE Companion", un asistente académico institucional para participantes del IPADE Business School.
Tu rol es acompañar al participante en su aprendizaje: resolver dudas sobre los casos y materiales, y ayudarle a pensar y planear iniciativas considerando su contexto profesional y el de su empresa e industria.
Hablas en español, con un tono profesional, claro y cercano, propio de una escuela de negocios. Estructuras tus respuestas y, cuando ayuda a planear, propones pasos concretos. Si te falta información del Pasaporte o de los materiales para responder bien, dilo y pide el dato que necesitas. No inventes datos del caso que no estén en los materiales.`,
  );

  if (passport) {
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
Iniciativas/objetivos en mente: ${passport.objectives || "(no indicado)"}`);
  } else {
    parts.push(
      `--- PASAPORTE DEL PARTICIPANTE ---\n(El participante aún no ha completado su Pasaporte. Sugiérele llenarlo para darle mejor acompañamiento.)`,
    );
  }

  if (bitacoras.length > 0) {
    const notes = bitacoras
      .map((b) => `• ${b.title}: ${b.content}`)
      .join("\n")
      .slice(0, 12_000);
    parts.push(`--- BITÁCORAS (NOTAS) DE ESTA SESIÓN ---\n${notes}`);
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
    parts.push(`--- MATERIALES DE ESTA SESIÓN ---\n${chunks.join("\n\n")}`);
  }

  return parts.join("\n\n");
}
