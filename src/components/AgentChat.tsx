import { useEffect, useRef, useState, type FormEvent } from "react";
import { supabase } from "../lib/supabase";
import { askAgent } from "../lib/agent";
import type { AgentMessage } from "../lib/types";

interface Props {
  /** Sesión sobre la que conversa el agente. `null` = asistente general
   *  (sólo usa el contexto del Pasaporte, no bitácoras ni documentos). */
  sessionId: string | null;
  userId: string;
  /** Texto introductorio que muestra el agente cuando no hay mensajes. */
  intro?: string;
  /** Altura del log de chat (CSS). */
  logHeight?: string;
}

export default function AgentChat({ sessionId, userId, intro, logHeight }: Props) {
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let query = supabase
      .from("agent_messages")
      .select("*")
      .order("created_at", { ascending: true });
    // Supabase exige `.is(col, null)` para comparar contra NULL.
    query = sessionId ? query.eq("session_id", sessionId) : query.is("session_id", null);
    query.then(({ data, error }) => {
      if (error) setError(error.message);
      else setMessages((data as AgentMessage[]) ?? []);
    });
  }, [sessionId]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, busy]);

  async function send(e: FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    setError(null);
    setBusy(true);

    const userMsg: AgentMessage = {
      id: `tmp-${Date.now()}`,
      user_id: userId,
      session_id: sessionId,
      role: "user",
      content: text,
      created_at: new Date().toISOString(),
    };
    setMessages((m) => [...m, userMsg]);
    await supabase
      .from("agent_messages")
      .insert({ session_id: sessionId, user_id: userId, role: "user", content: text });

    try {
      const history = messages.map((m) => ({ role: m.role, content: m.content }));
      const reply = await askAgent({ sessionId, message: text, history });
      const botMsg: AgentMessage = {
        id: `tmp-bot-${Date.now()}`,
        user_id: userId,
        session_id: sessionId,
        role: "assistant",
        content: reply,
        created_at: new Date().toISOString(),
      };
      setMessages((m) => [...m, botMsg]);
      await supabase
        .from("agent_messages")
        .insert({ session_id: sessionId, user_id: userId, role: "assistant", content: reply });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error del agente.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {error && <div className="alert alert-error">{error}</div>}

      <div className="chat-log" ref={logRef} style={logHeight ? { maxHeight: logHeight } : undefined}>
        {messages.length === 0 && !busy && (
          <div className="bubble assistant">
            {intro ??
              "Hola, soy tu IPADE Companion. ¿En qué te puedo ayudar? Puedo resolver dudas o ayudarte a planear una iniciativa considerando el contexto de tu empresa."}
          </div>
        )}
        {messages.map((m) => (
          <div key={m.id} className={`bubble ${m.role}`}>
            {m.content}
          </div>
        ))}
        {busy && <div className="bubble assistant">Pensando…</div>}
      </div>

      <form className="chat-input" onSubmit={send}>
        <textarea
          value={input}
          placeholder="Escribe tu mensaje…  (Enter para enviar, Shift+Enter para salto de línea)"
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send(e);
            }
          }}
        />
        <button className="btn btn-primary" disabled={busy || !input.trim()}>
          {busy ? <span className="spinner" /> : "Enviar"}
        </button>
      </form>
    </>
  );
}
