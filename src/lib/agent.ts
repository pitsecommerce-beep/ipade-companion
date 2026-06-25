import { supabase } from "./supabase";
import type { AgentMessage } from "./types";

export interface AgentReply {
  reply: string;
}

/**
 * Llama a la Edge Function `agent` de Supabase. La función es quien guarda la
 * ANTHROPIC_API_KEY como secret y arma el contexto (Pasaporte + bitácoras +
 * documentos de la sesión) antes de invocar a Claude. El frontend nunca ve la
 * llave: solo envía el mensaje del usuario y la sesión sobre la que pregunta.
 */
export async function askAgent(params: {
  sessionId: string | null;
  message: string;
  history: Pick<AgentMessage, "role" | "content">[];
}): Promise<string> {
  const { data, error } = await supabase.functions.invoke<AgentReply>("agent", {
    body: {
      sessionId: params.sessionId,
      message: params.message,
      history: params.history,
    },
  });

  if (error) {
    throw new Error(
      `No se pudo contactar al agente. Verifica que la Edge Function "agent" esté desplegada y con ANTHROPIC_API_KEY configurada. (${error.message})`,
    );
  }
  if (!data?.reply) {
    throw new Error("El agente respondió vacío.");
  }
  return data.reply;
}
