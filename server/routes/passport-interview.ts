import { Router } from "express";
import { createUserClient } from "../lib/supabase.js";

const router = Router();

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-opus-4-8";
const MAX_HISTORY = 50;

interface ReqBody {
  message: string;
  history?: { role: "user" | "assistant"; content: string }[];
}

interface PassportAnswers {
  dev_priorities: string;
  strategic_initiative: string;
  obstacles: string;
  additional_context: string;
}

interface PassportInput {
  full_name: string;
  role: string;
  seniority: string;
  personal_context: string;
  company_name: string;
  industry: string;
  company_size: string;
  company_role: string;
  industry_context: string;
  company_context: string;
  objectives: string;
  answers: PassportAnswers;
}

const PROPOSE_TOOL = {
  name: "proponer_cierre",
  description:
    "Llama esta herramienta cuando consideres que ya cubriste todos los temas de la entrevista. NO la llames antes de haber preguntado por todos los campos. El participante decidirá si está listo para finalizar.",
  input_schema: {
    type: "object" as const,
    properties: {},
  },
};

const SAVE_TOOL = {
  name: "guardar_pasaporte",
  description:
    "Llama SOLO cuando el participante confirme que quiere finalizar (mensaje '[FINALIZAR]'). Rellena cada campo EXCLUSIVAMENTE con lo que el participante dijo textualmente. Si un campo no fue mencionado, déjalo como cadena vacía. NUNCA inventes, inferir ni completes información que no fue dicha.",
  input_schema: {
    type: "object" as const,
    properties: {
      full_name: { type: "string" },
      role: { type: "string" },
      seniority: { type: "string" },
      personal_context: { type: "string" },
      company_name: { type: "string" },
      industry: { type: "string" },
      company_size: { type: "string" },
      company_role: { type: "string" },
      industry_context: { type: "string" },
      company_context: { type: "string" },
      objectives: { type: "string" },
      answers: {
        type: "object",
        properties: {
          dev_priorities: { type: "string" },
          strategic_initiative: { type: "string" },
          obstacles: { type: "string" },
          additional_context: { type: "string" },
        },
        required: [
          "dev_priorities",
          "strategic_initiative",
          "obstacles",
          "additional_context",
        ],
      },
    },
    required: [
      "full_name",
      "role",
      "seniority",
      "personal_context",
      "company_name",
      "industry",
      "company_size",
      "company_role",
      "industry_context",
      "company_context",
      "objectives",
      "answers",
    ],
  },
};

const SYSTEM_PROMPT_BASE = `Eres entrevistador del IPADE Business School. Tu tarea es llenar el "Pasaporte IPADE" del participante mediante una conversación hablada.

QUÉ ES EL PASAPORTE IPADE: Un perfil ejecutivo que recoge quién es el participante, su empresa, su industria y sus prioridades de desarrollo directivo. Se usa para personalizar su experiencia académica en el programa IPADE. No es un examen ni una evaluación.

Tus respuestas se LEEN EN VOZ ALTA por un sintetizador de voz.

FORMATO OBLIGATORIO de cada respuesta:
Máximo UNA frase de confirmación + UNA pregunta. Nada más.
Sin listas, sin markdown, sin emojis. Habla como persona.
Ejemplo: "Perfecto, Juan. ¿En qué empresa estás?"
Ejemplo: "Entendido. ¿Cuál es tu mayor obstáculo hoy?"

APERTURA (solo si el mensaje es "[INICIAR]" o historial vacío):
"Bienvenido. Empecemos: ¿cuál es tu nombre completo?"

FLUJO — pregunta uno por uno:
1. Nombre completo
2. Puesto o cargo
3. Trayectoria breve
4. Qué te trae al IPADE y objetivos personales
5. Nombre de tu empresa
6. Industria y tamaño
7. Posición de la empresa en su industria
8. Contexto de la industria y situación actual de la empresa
9. Iniciativas u objetivos de la empresa
10. Tu prioridad de desarrollo directivo
11. Iniciativa estratégica prioritaria
12. Mayores obstáculos
13. Algo más que quieras agregar

Si la respuesta cubre varios puntos, avanza saltando los ya respondidos. Si es vaga, UNA repregunta máximo. Si no quiere responder, avanza.

ANTIALUCINACIÓN — REGLAS ABSOLUTAS:
- SOLO registra lo que el participante DIJO TEXTUALMENTE. No parafrasees creativamente.
- NUNCA inventes datos, nombres, cifras, industrias ni contextos que no hayan sido mencionados.
- Si no tienes información sobre un campo, déjalo VACÍO. Vacío es mejor que inventado.
- No asumas la industria por el nombre de la empresa. No asumas el tamaño. No completes frases.
- Si algo no quedó claro, pregunta. No llenes el hueco con tu imaginación.

CIERRE — REGLAS ESTRICTAS:
- NO propongas cerrar hasta que hayas hecho preguntas sobre TODOS los 13 puntos del flujo.
- Si el participante en una respuesta cubre varios puntos, cuenta esos como cubiertos, pero NO cuentes como cubierto un punto que nunca se preguntó ni se mencionó.
- Antes de llamar "proponer_cierre", verifica internamente que tienes información (o un "no quiero responder") para CADA punto del 1 al 13. Si te falta alguno, pregúntalo primero.
- Cuando estés seguro de que cubriste todo, llama "proponer_cierre" y di algo breve como "Creo que ya cubrimos todo. Cuando quieras, finalizamos."
- NO llames "guardar_pasaporte" tú solo. Solo llámala cuando el mensaje del usuario sea "[FINALIZAR]".
- Cuando recibas "[FINALIZAR]", llama "guardar_pasaporte" llenando SOLO con lo dicho por el participante.

NOTAS SOBRE LA TRANSCRIPCIÓN DE VOZ:
- El texto del usuario viene de un reconocimiento de voz automático. Puede contener errores de transcripción, frases cortadas o muletillas.
- Si una respuesta parece incompleta o cortada, pide amablemente que repita o amplíe.
- No interpretes una frase cortada como respuesta completa.

INTERRUPCIONES:
- A veces el mensaje del usuario incluirá una nota "[SISTEMA: El participante te interrumpió...]". Esto significa que el participante empezó a hablar mientras tú todavía estabas hablando.
- Cuando te interrumpan, NO repitas tu respuesta anterior. Escucha lo que dice el participante y decide: si lo que dijo responde o complementa tu pregunta anterior, avanza. Si cambió de tema o corrigió algo, adáptate.
- Sé natural: "Entendido." o "Claro." y continúa. No digas "veo que me interrumpiste" ni hagas referencia explícita a la interrupción.`;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildSystemPrompt(passport: any): string {
  if (!passport) return SYSTEM_PROMPT_BASE;

  const ans = (passport.answers ?? {}) as Record<string, string>;
  const known: string[] = [];
  const add = (label: string, val: string | undefined) => {
    if (val?.trim()) known.push(`${label}: ${val}`);
  };

  add("Nombre completo", passport.full_name);
  add("Puesto", passport.role);
  add("Trayectoria", passport.seniority);
  add("Contexto personal", passport.personal_context);
  add("Empresa", passport.company_name);
  add("Industria", passport.industry);
  add("Tamaño", passport.company_size);
  add("Posición en la industria", passport.company_role);
  add("Contexto de la industria", passport.industry_context);
  add("Situación de la empresa", passport.company_context);
  add("Objetivos", passport.objectives);
  add("Prioridad de desarrollo", ans.dev_priorities);
  add("Iniciativa estratégica", ans.strategic_initiative);
  add("Obstáculos", ans.obstacles);
  add("Contexto adicional", ans.additional_context);

  if (known.length === 0) return SYSTEM_PROMPT_BASE;

  return `${SYSTEM_PROMPT_BASE}

DATOS YA CONOCIDOS DEL PARTICIPANTE (no los repreguntess; confírmalos brevemente y avanza a lo que falta):
${known.join("\n")}`;
}

router.post("/", async (req, res) => {
  try {
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

    const supabase = createUserClient(authHeader);
    const { data: { user }, error: userErr } = await supabase.auth.getUser();
    if (userErr || !user) {
      res.status(401).json({ error: "Sesión no válida." });
      return;
    }

    const { data: passport } = await supabase
      .from("passports")
      .select("*")
      .eq("user_id", user.id)
      .maybeSingle();

    const systemPrompt = buildSystemPrompt(passport);

    const history = (body.history ?? []).slice(-MAX_HISTORY);
    const messages = [
      ...history.map((m) => ({ role: m.role, content: m.content })),
      { role: "user", content: body.message },
    ];

    const tools = messages.length >= 20
      ? [PROPOSE_TOOL, SAVE_TOOL]
      : [SAVE_TOOL];

    const aiRes = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1500,
        system: systemPrompt,
        tools,
        messages,
      }),
    });

    if (!aiRes.ok) {
      const detail = await aiRes.text();
      res.status(502).json({ error: `Error de Claude (${aiRes.status}): ${detail.slice(0, 500)}` });
      return;
    }

    const data = await aiRes.json() as {
      content?: { type: string; text?: string; name?: string; input?: PassportInput }[];
    };

    const blocks = data.content ?? [];
    const textParts = blocks.filter((b) => b.type === "text").map((b) => b.text ?? "");
    const reply = textParts.join("\n").trim() || "";

    const proposeBlock = blocks.find((b) => b.type === "tool_use" && b.name === "proponer_cierre");
    const saveBlock = blocks.find((b) => b.type === "tool_use" && b.name === "guardar_pasaporte");

    if (saveBlock && saveBlock.input) {
      const p = saveBlock.input;
      res.json({
        done: true,
        reply: reply || "Listo, revisa los datos de tu Pasaporte.",
        passport: {
          full_name: p.full_name ?? "",
          role: p.role ?? "",
          seniority: p.seniority ?? "",
          personal_context: p.personal_context ?? "",
          company_name: p.company_name ?? "",
          industry: p.industry ?? "",
          company_size: p.company_size ?? "",
          company_role: p.company_role ?? "",
          industry_context: p.industry_context ?? "",
          company_context: p.company_context ?? "",
          objectives: p.objectives ?? "",
          answers: {
            dev_priorities: p.answers?.dev_priorities ?? "",
            strategic_initiative: p.answers?.strategic_initiative ?? "",
            obstacles: p.answers?.obstacles ?? "",
            additional_context: p.answers?.additional_context ?? "",
          },
        },
      });
    } else if (proposeBlock) {
      res.json({
        done: false,
        propose_done: true,
        reply: reply || "Creo que ya cubrimos todo. Cuando quieras, finalizamos.",
      });
    } else {
      res.json({
        done: false,
        reply: reply || "(El agente no devolvió texto.)",
      });
    }
  } catch (err) {
    console.error("[passport-interview] Error:", err);
    res.status(500).json({
      error: `Error inesperado: ${err instanceof Error ? err.message : String(err)}`,
    });
  }
});

export default router;
