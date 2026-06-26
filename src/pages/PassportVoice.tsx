import { useState, useRef, useEffect, useCallback, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { supabase } from "../lib/supabase";
import { interviewTurn, type PassportInput } from "../lib/agent";

type Status = "idle" | "listening" | "thinking" | "speaking";

interface Message {
  role: "user" | "assistant";
  content: string;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
const SpeechRecognitionAPI =
  typeof window !== "undefined"
    ? (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition
    : null;
/* eslint-enable @typescript-eslint/no-explicit-any */

const hasSpeechRecognition = !!SpeechRecognitionAPI;
const hasSpeechSynthesis = typeof window !== "undefined" && "speechSynthesis" in window;

function pickSpanishVoice(): SpeechSynthesisVoice | null {
  const voices = speechSynthesis.getVoices();
  const isGoodVoice = (v: SpeechSynthesisVoice) =>
    /google|microsoft|natural|enhanced|premium/i.test(v.name);
  const spanish = voices.filter((v) => v.lang.startsWith("es"));
  return spanish.find((v) => v.lang === "es-MX" && isGoodVoice(v))
    ?? spanish.find(isGoodVoice)
    ?? spanish.find((v) => v.lang === "es-MX")
    ?? spanish[0]
    ?? null;
}

function speakBrowser(text: string, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (!hasSpeechSynthesis) { resolve(); return; }
    speechSynthesis.cancel();

    if (signal?.aborted) { resolve(); return; }

    const utt = new SpeechSynthesisUtterance(text);
    utt.lang = "es-MX";
    utt.rate = 1.25;
    utt.pitch = 1.0;
    const voice = pickSpanishVoice();
    if (voice) utt.voice = voice;
    utt.onend = () => resolve();
    utt.onerror = () => resolve();

    signal?.addEventListener("abort", () => {
      speechSynthesis.cancel();
    });

    speechSynthesis.speak(utt);
  });
}

async function speakTTS(text: string, signal?: AbortSignal): Promise<boolean> {
  try {
    const res = await fetch("/api/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
      signal,
    });
    if (!res.ok) return false;

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    audio.preload = "auto";

    return new Promise((resolve) => {
      const cleanup = () => URL.revokeObjectURL(url);

      audio.onended = () => { cleanup(); resolve(true); };
      audio.onerror = () => { cleanup(); resolve(false); };

      signal?.addEventListener("abort", () => {
        audio.pause();
        audio.src = "";
        cleanup();
        resolve(true);
      });

      audio.play().catch(() => { cleanup(); resolve(false); });
    });
  } catch {
    return false;
  }
}

async function speak(text: string, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return;
  const ok = await speakTTS(text, signal);
  if (!ok && !signal?.aborted) {
    await speakBrowser(text, signal);
  }
}

export default function PassportVoice() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [started, setStarted] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [status, setStatus] = useState<Status>("idle");
  const [interim, setInterim] = useState("");
  const [textInput, setTextInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [autoListen, setAutoListen] = useState(hasSpeechRecognition);

  const [done, setDone] = useState(false);
  const [passport, setPassport] = useState<PassportInput | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recognitionRef = useRef<any>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const historyRef = useRef<Message[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const autoListenRef = useRef(autoListen);

  useEffect(() => { autoListenRef.current = autoListen; }, [autoListen]);

  useEffect(() => {
    historyRef.current = messages;
  }, [messages]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, interim, status]);

  useEffect(() => {
    if (hasSpeechSynthesis) {
      speechSynthesis.getVoices();
      speechSynthesis.onvoiceschanged = () => speechSynthesis.getVoices();
    }
  }, []);

  const stopEverything = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }
    if (hasSpeechSynthesis) {
      speechSynthesis.cancel();
    }
    setStatus("idle");
    setInterim("");
  }, []);

  const startListening = useCallback(() => {
    if (!SpeechRecognitionAPI) return;
    setInterim("");
    const recognition = new SpeechRecognitionAPI();
    recognition.lang = "es-MX";
    recognition.interimResults = true;
    recognition.continuous = false;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    recognition.onresult = (event: any) => {
      let final = "";
      let interimText = "";
      for (let i = 0; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          final += result[0].transcript;
        } else {
          interimText += result[0].transcript;
        }
      }
      setInterim(interimText);
      if (final) {
        recognition.stop();
        setInterim("");
        sendTurn(final);
      }
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    recognition.onerror = (event: any) => {
      if (event.error === "not-allowed") {
        setError("Permiso de micrófono denegado. Puedes escribir tu respuesta abajo.");
      } else if (event.error !== "aborted") {
        setError(`Error de micrófono: ${event.error}`);
      }
      setStatus("idle");
      setInterim("");
    };

    recognition.onend = () => {
      recognitionRef.current = null;
    };

    recognitionRef.current = recognition;
    setStatus("listening");
    recognition.start();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sendTurn = useCallback(async (userText: string) => {
    const userMsg: Message = { role: "user", content: userText };
    setMessages((prev) => [...prev, userMsg]);
    setStatus("thinking");
    setError(null);

    const ac = new AbortController();
    abortRef.current = ac;

    const history = [...historyRef.current, userMsg].map((m) => ({
      role: m.role,
      content: m.content,
    }));

    try {
      const result = await interviewTurn(
        { message: userText, history: history.slice(0, -1) },
        ac.signal,
      );

      if (ac.signal.aborted) return;

      const assistantMsg: Message = { role: "assistant", content: result.reply };
      setMessages((prev) => [...prev, assistantMsg]);

      if (result.done && result.passport) {
        setDone(true);
        setPassport(result.passport);
        setStatus("speaking");
        await speak(result.reply, ac.signal);
        if (!ac.signal.aborted) setStatus("idle");
      } else {
        setStatus("speaking");
        await speak(result.reply, ac.signal);
        if (!ac.signal.aborted) {
          setStatus("idle");
          if (autoListenRef.current && hasSpeechRecognition) {
            startListening();
          }
        }
      }
    } catch (err) {
      if (ac.signal.aborted) return;
      setError(err instanceof Error ? err.message : "Error al contactar al agente.");
      setStatus("idle");
    } finally {
      if (abortRef.current === ac) abortRef.current = null;
    }
  }, [startListening]);

  const handleStart = useCallback(async () => {
    setStarted(true);
    await sendTurn("[INICIAR]");
  }, [sendTurn]);

  const stopListening = useCallback(() => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }
    setStatus("idle");
    setInterim("");
  }, []);

  const handleTextSubmit = useCallback((e: FormEvent) => {
    e.preventDefault();
    const text = textInput.trim();
    if (!text) return;
    setTextInput("");
    sendTurn(text);
  }, [textInput, sendTurn]);

  const updatePassportField = (key: string, value: string) => {
    if (!passport) return;
    if (key.startsWith("answers.")) {
      const subKey = key.replace("answers.", "");
      setPassport({ ...passport, answers: { ...passport.answers, [subKey]: value } });
    } else {
      setPassport({ ...passport, [key]: value });
    }
  };

  const handleSave = async () => {
    if (!user || !passport) return;
    setSaving(true);
    setError(null);
    const { error } = await supabase
      .from("passports")
      .upsert(
        {
          full_name: passport.full_name,
          role: passport.role,
          seniority: passport.seniority,
          personal_context: passport.personal_context,
          company_name: passport.company_name,
          industry: passport.industry,
          company_size: passport.company_size,
          company_role: passport.company_role,
          industry_context: passport.industry_context,
          company_context: passport.company_context,
          objectives: passport.objectives,
          answers: passport.answers,
          user_id: user.id,
        },
        { onConflict: "user_id" },
      );
    setSaving(false);
    if (error) {
      setError(error.message);
    } else {
      setSavedMsg("Pasaporte guardado correctamente.");
      setTimeout(() => navigate("/pasaporte"), 1200);
    }
  };

  // Pantalla de inicio
  if (!started) {
    return (
      <>
        <div className="page-head">
          <h1>Pasaporte IPADE por voz</h1>
          <p>
            Un entrevistador te hará preguntas y llenará tu Pasaporte IPADE por ti.
            Solo habla con naturalidad y al final revisa los datos antes de guardar.
          </p>
        </div>

        {!hasSpeechRecognition && (
          <div className="alert alert-info" style={{ marginBottom: 16 }}>
            Tu navegador no soporta reconocimiento de voz. Podrás escribir tus respuestas en texto.
          </div>
        )}

        <div className="card" style={{ textAlign: "center", padding: "48px 24px" }}>
          <button
            className="btn btn-primary"
            style={{ fontSize: 18, padding: "16px 48px" }}
            onClick={handleStart}
          >
            Comenzar
          </button>
          <p style={{ color: "var(--muted)", marginTop: 16, marginBottom: 0, fontSize: 14 }}>
            {hasSpeechRecognition
              ? "Se te pedirá permiso para usar el micrófono."
              : "Podrás escribir tus respuestas en un campo de texto."}
          </p>
        </div>
      </>
    );
  }

  // Panel de revisión
  if (done && passport) {
    return (
      <>
        <div className="page-head">
          <h1>Revisa tu Pasaporte</h1>
          <p>Estos son los datos que el entrevistador registró. Edita lo que necesites y guarda.</p>
        </div>

        {error && <div className="alert alert-error">{error}</div>}
        {savedMsg && <div className="alert alert-ok">{savedMsg}</div>}

        <div className="card">
          <h2 style={{ marginTop: 0 }}>Sobre ti</h2>
          <ReviewField label="Nombre completo" value={passport.full_name} onChange={(v) => updatePassportField("full_name", v)} />
          <ReviewField label="Puesto / cargo" value={passport.role} onChange={(v) => updatePassportField("role", v)} />
          <ReviewField label="Trayectoria" value={passport.seniority} onChange={(v) => updatePassportField("seniority", v)} />
          <ReviewField label="Contexto personal / objetivos" value={passport.personal_context} onChange={(v) => updatePassportField("personal_context", v)} long />
        </div>

        <div className="card">
          <h2 style={{ marginTop: 0 }}>Sobre tu empresa e industria</h2>
          <ReviewField label="Nombre de la empresa" value={passport.company_name} onChange={(v) => updatePassportField("company_name", v)} />
          <ReviewField label="Industria / sector" value={passport.industry} onChange={(v) => updatePassportField("industry", v)} />
          <ReviewField label="Tamaño de la empresa" value={passport.company_size} onChange={(v) => updatePassportField("company_size", v)} />
          <ReviewField label="Posición en la industria" value={passport.company_role} onChange={(v) => updatePassportField("company_role", v)} />
          <ReviewField label="Contexto de la industria" value={passport.industry_context} onChange={(v) => updatePassportField("industry_context", v)} long />
          <ReviewField label="Situación de la empresa" value={passport.company_context} onChange={(v) => updatePassportField("company_context", v)} long />
          <ReviewField label="Objetivos / iniciativas" value={passport.objectives} onChange={(v) => updatePassportField("objectives", v)} long />
        </div>

        <div className="card">
          <h2 style={{ marginTop: 0 }}>Desarrollo directivo</h2>
          <ReviewField label="Prioridad de desarrollo" value={passport.answers.dev_priorities} onChange={(v) => updatePassportField("answers.dev_priorities", v)} long />
          <ReviewField label="Iniciativa estratégica prioritaria" value={passport.answers.strategic_initiative} onChange={(v) => updatePassportField("answers.strategic_initiative", v)} long />
          <ReviewField label="Mayores obstáculos" value={passport.answers.obstacles} onChange={(v) => updatePassportField("answers.obstacles", v)} long />
          <ReviewField label="Contexto adicional" value={passport.answers.additional_context} onChange={(v) => updatePassportField("answers.additional_context", v)} long />
        </div>

        <div className="btn-row" style={{ marginTop: 16 }}>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? "Guardando…" : "Guardar Pasaporte"}
          </button>
        </div>
      </>
    );
  }

  // Conversación
  return (
    <>
      <div className="page-head">
        <h1>Entrevista de Pasaporte</h1>
        <p style={{ marginBottom: 0 }}>
          {status === "listening" && "Escuchando…"}
          {status === "thinking" && "Pensando…"}
          {status === "speaking" && "Hablando…"}
          {status === "idle" && "Listo para continuar."}
        </p>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      <div className="card" style={{ maxHeight: "60vh", overflowY: "auto", padding: "16px 20px" }}>
        {messages.map((msg, i) => (
          <div
            key={i}
            style={{
              display: "flex",
              justifyContent: msg.role === "user" ? "flex-end" : "flex-start",
              marginBottom: 12,
            }}
          >
            <div
              style={{
                maxWidth: "80%",
                padding: "10px 16px",
                borderRadius: 12,
                background: msg.role === "user" ? "var(--ipade-blue, #1a2744)" : "var(--surface, #f4f4f5)",
                color: msg.role === "user" ? "#fff" : "inherit",
                fontSize: 15,
                lineHeight: 1.5,
              }}
            >
              {msg.content}
            </div>
          </div>
        ))}

        {interim && (
          <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 12 }}>
            <div
              style={{
                maxWidth: "80%",
                padding: "10px 16px",
                borderRadius: 12,
                background: "var(--ipade-blue, #1a2744)",
                color: "#fff",
                opacity: 0.6,
                fontSize: 15,
              }}
            >
              {interim}
            </div>
          </div>
        )}

        {status === "thinking" && (
          <div style={{ display: "flex", justifyContent: "flex-start", marginBottom: 12 }}>
            <div
              style={{
                padding: "10px 16px",
                borderRadius: 12,
                background: "var(--surface, #f4f4f5)",
                fontSize: 15,
                color: "var(--muted)",
              }}
            >
              Pensando…
            </div>
          </div>
        )}

        <div ref={chatEndRef} />
      </div>

      <div style={{ marginTop: 16, display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
        {hasSpeechRecognition && status === "idle" && (
          <button className="btn btn-primary" onClick={startListening}>
            Hablar
          </button>
        )}
        {status === "listening" && (
          <button className="btn" style={{ background: "#c0392b", color: "#fff", border: "none" }} onClick={stopListening}>
            Dejar de escuchar
          </button>
        )}
        {(status === "thinking" || status === "speaking") && (
          <button
            className="btn"
            style={{ background: "#c0392b", color: "#fff", border: "none" }}
            onClick={stopEverything}
          >
            Detener
          </button>
        )}

        {hasSpeechRecognition && (
          <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, color: "var(--muted)", cursor: "pointer", userSelect: "none" }}>
            <input
              type="checkbox"
              checked={autoListen}
              onChange={(e) => setAutoListen(e.target.checked)}
              style={{ width: "auto" }}
            />
            Escuchar automáticamente
          </label>
        )}
      </div>

      {/* Fallback de texto */}
      <form onSubmit={handleTextSubmit} style={{ marginTop: 12, display: "flex", gap: 8 }}>
        <input
          type="text"
          placeholder={hasSpeechRecognition ? "O escribe tu respuesta aquí" : "Escribe tu respuesta"}
          value={textInput}
          onChange={(e) => setTextInput(e.target.value)}
          disabled={status !== "idle"}
          style={{ flex: 1 }}
        />
        <button className="btn" type="submit" disabled={status !== "idle" || !textInput.trim()}>
          Enviar
        </button>
      </form>
    </>
  );
}

function ReviewField({
  label,
  value,
  onChange,
  long,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  long?: boolean;
}) {
  return (
    <div className="field">
      <label>{label}</label>
      {long ? (
        <textarea value={value} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <input value={value} onChange={(e) => onChange(e.target.value)} />
      )}
    </div>
  );
}
