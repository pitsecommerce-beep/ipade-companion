import { supabase } from "./supabase";
import type { AgentMessage, Initiative, InitiativeReport } from "./types";

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

export interface GenerateReportResult {
  report: InitiativeReport;
  initiatives: Initiative[];
}

export async function generateReport(): Promise<GenerateReportResult> {
  const { data, error } = await supabase.functions.invoke<GenerateReportResult>(
    "generate-report",
    { body: {} },
  );
  if (error) {
    throw new Error(
      `No se pudo generar el reporte. Verifica que la Edge Function "generate-report" esté desplegada. (${error.message})`,
    );
  }
  if (!data?.report) {
    throw new Error("El reporte devuelto está vacío.");
  }
  return data;
}

export async function sendReminder(reminderId: string): Promise<void> {
  const { error } = await supabase.functions.invoke("send-reminder", {
    body: { reminderId },
  });
  if (error) {
    throw new Error(`No se pudo enviar el recordatorio: ${error.message}`);
  }
}
