// Tipos del dominio de IPADE Companion. Reflejan el esquema de Supabase
// (ver supabase/migrations).

export interface Passport {
  id: string;
  user_id: string;
  // Sobre la persona
  full_name: string;
  role: string; // puesto / cargo
  seniority: string; // años de experiencia / nivel
  personal_context: string; // motivaciones, objetivos personales en el programa
  // Sobre la empresa
  company_name: string;
  industry: string; // industria
  company_size: string; // número de empleados / facturación aprox.
  company_role: string; // rol de la empresa en su industria
  industry_context: string; // dinámica/competencia/tendencias de la industria
  company_context: string; // situación actual, retos, prioridades de la empresa
  objectives: string; // qué espera lograr / iniciativas en mente
  // Respuestas adicionales flexibles
  answers: Record<string, string>;
  created_at: string;
  updated_at: string;
}

export interface StudySession {
  id: string;
  user_id: string;
  title: string;
  description: string | null;
  created_at: string;
  updated_at: string;
}

export interface Bitacora {
  id: string;
  user_id: string;
  session_id: string;
  title: string;
  content: string;
  created_at: string;
  updated_at: string;
}

export interface DocumentRecord {
  id: string;
  user_id: string;
  session_id: string;
  name: string;
  storage_path: string;
  mime_type: string | null;
  size_bytes: number | null;
  content_text: string | null; // texto extraído (p.ej. de PDFs) para el agente
  created_at: string;
}

export interface InitiativeReport {
  id: string;
  user_id: string;
  content: string; // markdown
  created_at: string;
}

export type InitiativeCategory = "inmediata" | "portafolio";
export type InitiativeStatus = "pendiente" | "en_progreso" | "completada" | "diferida";

export interface Initiative {
  id: string;
  user_id: string;
  report_id: string | null;
  title: string;
  description: string;
  category: InitiativeCategory;
  source: "passport" | "bitacora" | "manual";
  email_subject: string;
  email_body: string;
  status: InitiativeStatus;
  created_at: string;
  updated_at: string;
}

export interface EmailReminder {
  id: string;
  user_id: string;
  initiative_id: string | null;
  email_to: string;
  subject: string;
  body: string;
  send_at: string | null;
  sent_at: string | null;
  status: "pendiente" | "enviado" | "fallido";
  error_msg: string | null;
  created_at: string;
}

export interface AgentMessage {
  id: string;
  user_id: string;
  session_id: string | null;
  role: "user" | "assistant";
  content: string;
  created_at: string;
}
