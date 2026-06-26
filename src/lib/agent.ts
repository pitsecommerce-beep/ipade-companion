import { supabase } from "./supabase";
import type { Initiative, InitiativeReport } from "./types";

/** Obtiene el token de sesión activo para enviarlo al servidor. */
async function authHeader(): Promise<string> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) {
    throw new Error("No hay sesión activa. Vuelve a iniciar sesión.");
  }
  return `Bearer ${session.access_token}`;
}

/** Llama a una ruta /api/* del servidor Railway con el token de sesión. */
async function callApi<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": await authHeader(),
    },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
    throw new Error(err.error ?? `Error del servidor (${res.status})`);
  }
  return res.json() as Promise<T>;
}

/* ------------------------------------------------------------------ */
/* Chat con el agente                                                   */
/* ------------------------------------------------------------------ */
export interface AgentReply { reply: string }

export async function askAgent(params: {
  sessionId: string | null;
  message: string;
  history: { role: "user" | "assistant"; content: string }[];
}): Promise<string> {
  const data = await callApi<AgentReply>("/api/agent", {
    sessionId: params.sessionId,
    message: params.message,
    history: params.history,
  });
  if (!data.reply) throw new Error("El agente respondió vacío.");
  return data.reply;
}

/* ------------------------------------------------------------------ */
/* Entrevista de voz para el Pasaporte                                  */
/* ------------------------------------------------------------------ */
export interface PassportAnswers {
  dev_priorities: string;
  strategic_initiative: string;
  obstacles: string;
  additional_context: string;
}

export interface PassportInput {
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

export interface InterviewTurnResult {
  done: boolean;
  propose_done?: boolean;
  reply: string;
  passport?: PassportInput;
}

export async function interviewTurn(
  params: {
    message: string;
    history: { role: "user" | "assistant"; content: string }[];
  },
  signal?: AbortSignal,
): Promise<InterviewTurnResult> {
  return callApi<InterviewTurnResult>("/api/passport-interview", params, signal);
}

/* ------------------------------------------------------------------ */
/* Generación de Plan de Acción                                         */
/* ------------------------------------------------------------------ */
export interface GenerateReportResult {
  report: InitiativeReport;
  initiatives: Initiative[];
}

export async function generateReport(): Promise<GenerateReportResult> {
  const data = await callApi<GenerateReportResult>("/api/generate-report", {});
  if (!data.report) throw new Error("El reporte devuelto está vacío.");
  return data;
}

/* ------------------------------------------------------------------ */
/* Envío de recordatorio por correo                                     */
/* ------------------------------------------------------------------ */
export async function sendReminder(reminderId: string): Promise<void> {
  await callApi<{ ok: boolean }>("/api/send-reminder", { reminderId });
}
