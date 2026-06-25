import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { supabase, MATERIALS_BUCKET } from "../lib/supabase";
import { extractPdfText } from "../lib/pdf";
import { askAgent } from "../lib/agent";
import type { AgentMessage, Bitacora, DocumentRecord, StudySession } from "../lib/types";

type Tab = "bitacoras" | "materiales" | "agente";

/* Estructura interna del contenido de una bitácora */
interface BitacoraContent {
  notes: string;
  insight: string;
  quick_win: string;
  loose_end: string;
}

const EMPTY_CONTENT: BitacoraContent = {
  notes: "",
  insight: "",
  quick_win: "",
  loose_end: "",
};

function parseContent(raw: string): BitacoraContent {
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed === "object" && parsed !== null && "notes" in parsed) {
      return { ...EMPTY_CONTENT, ...parsed };
    }
  } catch {
    // legacy: contenido plain text → va a notas
  }
  return { ...EMPTY_CONTENT, notes: raw };
}

function serializeContent(c: BitacoraContent): string {
  return JSON.stringify(c);
}

export default function SessionDetail() {
  const { id = "" } = useParams();
  const { user } = useAuth();
  const [session, setSession] = useState<StudySession | null>(null);
  const [tab, setTab] = useState<Tab>("bitacoras");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    supabase
      .from("study_sessions")
      .select("*")
      .eq("id", id)
      .maybeSingle()
      .then(({ data, error }) => {
        if (error) setError(error.message);
        else setSession(data as StudySession);
      });
  }, [id]);

  if (error) return <div className="alert alert-error">{error}</div>;
  if (!session) return <div className="card">Cargando jornada…</div>;
  if (!user) return null;

  return (
    <>
      <div className="page-head">
        <Link to="/" className="muted" style={{ fontSize: 13 }}>
          ← Mis jornadas
        </Link>
        <h1 style={{ marginTop: 6 }}>{session.title}</h1>
        {session.description && <p>{session.description}</p>}
      </div>

      <div className="tabs">
        <button className={tab === "bitacoras" ? "active" : ""} onClick={() => setTab("bitacoras")}>
          Bitácoras
        </button>
        <button className={tab === "materiales" ? "active" : ""} onClick={() => setTab("materiales")}>
          Materiales
        </button>
        <button className={tab === "agente" ? "active" : ""} onClick={() => setTab("agente")}>
          Agente
        </button>
      </div>

      {tab === "bitacoras" && <Bitacoras sessionId={id} userId={user.id} />}
      {tab === "materiales" && <Materiales sessionId={id} userId={user.id} />}
      {tab === "agente" && <Agente sessionId={id} userId={user.id} />}
    </>
  );
}

/* ----------------------------- Bitácoras ----------------------------- */
function Bitacoras({ sessionId, userId }: { sessionId: string; userId: string }) {
  const [items, setItems] = useState<Bitacora[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Bitacora | null>(null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState<BitacoraContent>(EMPTY_CONTENT);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from("bitacoras")
      .select("*")
      .eq("session_id", sessionId)
      .order("updated_at", { ascending: false });
    if (error) setError(error.message);
    else setItems(data as Bitacora[]);
    setLoading(false);
  }, [sessionId]);

  useEffect(() => { load(); }, [load]);

  function reset() {
    setEditing(null);
    setTitle("");
    setBody(EMPTY_CONTENT);
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setSaving(true);
    setError(null);
    const content = serializeContent(body);
    let res;
    if (editing) {
      res = await supabase
        .from("bitacoras")
        .update({ title: title.trim(), content, updated_at: new Date().toISOString() })
        .eq("id", editing.id);
    } else {
      res = await supabase
        .from("bitacoras")
        .insert({ session_id: sessionId, user_id: userId, title: title.trim(), content });
    }
    setSaving(false);
    if (res.error) setError(res.error.message);
    else { reset(); load(); }
  }

  async function remove(b: Bitacora) {
    if (!confirm(`¿Eliminar la bitácora "${b.title}"?`)) return;
    const { error } = await supabase.from("bitacoras").delete().eq("id", b.id);
    if (error) setError(error.message);
    else { if (editing?.id === b.id) reset(); load(); }
  }

  function startEdit(b: Bitacora) {
    setEditing(b);
    setTitle(b.title);
    setBody(parseContent(b.content));
  }

  return (
    <div style={{ display: "grid", gap: 24, gridTemplateColumns: "minmax(0,1.2fr) minmax(0,0.8fr)" }}>
      {/* Panel izquierdo: formulario */}
      <div>
        {error && <div className="alert alert-error">{error}</div>}

        <form onSubmit={save}>
          {/* Título de la bitácora */}
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="field" style={{ marginBottom: 0 }}>
              <label htmlFor="b-title">
                {editing ? "Editando bitácora" : "Nueva bitácora"}
              </label>
              <input
                id="b-title"
                placeholder="Ej. Sesión de la mañana — Caso Cemex"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
              />
            </div>
          </div>

          {/* Notas durante la sesión */}
          <div className="card" style={{ marginBottom: 16 }}>
            <h3 style={{ marginTop: 0, marginBottom: 4, fontSize: 15, color: "var(--ipade-navy)" }}>
              Notas de la sesión
            </h3>
            <p className="muted" style={{ fontSize: 12, marginTop: 0, marginBottom: 12 }}>
              Para tomar durante la sesión — apuntes libres, ideas, referencias.
            </p>
            <textarea
              id="b-notes"
              style={{
                minHeight: 260,
                fontFamily: '"Inter", "Segoe UI", sans-serif',
                fontSize: 14,
                lineHeight: 1.7,
                background: "#fafbfc",
                border: "1px solid var(--line)",
                borderRadius: 6,
                padding: "14px 16px",
                resize: "vertical",
              }}
              placeholder="Escribe aquí tus apuntes, ideas y referencias mientras transcurre la sesión…"
              value={body.notes}
              onChange={(e) => setBody((b) => ({ ...b, notes: e.target.value }))}
            />
          </div>

          {/* Preguntas de reflexión posterior */}
          <div className="card" style={{ borderLeft: "4px solid var(--ipade-gold)", marginBottom: 16 }}>
            <h3 style={{ marginTop: 0, marginBottom: 4, fontSize: 15, color: "var(--ipade-navy)" }}>
              Reflexión posterior
            </h3>
            <p className="muted" style={{ fontSize: 12, marginTop: 0, marginBottom: 20 }}>
              Para completar al terminar la jornada — consolida lo aprendido.
            </p>

            <div className="field">
              <label htmlFor="b-insight">
                1. ¿Cuál fue el insight, concepto o momento clave que "te hizo clic"
                o desafió tu forma actual de pensar?
              </label>
              <textarea
                id="b-insight"
                style={{ minHeight: 90 }}
                placeholder="El concepto, caso o discusión que más te impactó o cuestionó…"
                value={body.insight}
                onChange={(e) => setBody((b) => ({ ...b, insight: e.target.value }))}
              />
            </div>

            <div className="field">
              <label htmlFor="b-quickwin">
                2. Nombra una sola acción concreta (Quick win) que puedas ejecutar
                en el próximo mes, inspirada en las sesiones de hoy.
              </label>
              <textarea
                id="b-quickwin"
                style={{ minHeight: 90 }}
                placeholder="Una acción específica, medible y alcanzable en los próximos 30 días…"
                value={body.quick_win}
                onChange={(e) => setBody((b) => ({ ...b, quick_win: e.target.value }))}
              />
            </div>

            <div className="field" style={{ marginBottom: 0 }}>
              <label htmlFor="b-looseend">
                3. ¿Qué duda, cabo suelto o inquietud te quedó dando vueltas en la
                cabeza sobre la que te gustaría profundizar?
              </label>
              <textarea
                id="b-looseend"
                style={{ minHeight: 90 }}
                placeholder="Una pregunta abierta, tensión no resuelta o tema que quieres explorar más…"
                value={body.loose_end}
                onChange={(e) => setBody((b) => ({ ...b, loose_end: e.target.value }))}
              />
            </div>
          </div>

          <div className="btn-row">
            <button className="btn btn-primary" disabled={saving}>
              {saving ? "Guardando…" : editing ? "Actualizar bitácora" : "Guardar bitácora"}
            </button>
            {editing && (
              <button type="button" className="btn btn-ghost" onClick={reset}>
                Cancelar
              </button>
            )}
          </div>
        </form>
      </div>

      {/* Panel derecho: lista */}
      <div>
        <h2 style={{ marginTop: 0, fontSize: 18 }}>Bitácoras de esta jornada</h2>
        {loading ? (
          <div className="card">Cargando…</div>
        ) : items.length === 0 ? (
          <div className="card muted">Aún no hay bitácoras en esta jornada.</div>
        ) : (
          items.map((b) => {
            const parsed = parseContent(b.content);
            const hasReflection = parsed.insight || parsed.quick_win || parsed.loose_end;
            return (
              <div key={b.id} className="card" style={{ padding: 16, marginBottom: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10, marginBottom: 8 }}>
                  <h3 style={{ margin: 0, fontSize: 15 }}>{b.title}</h3>
                  <small className="muted" style={{ whiteSpace: "nowrap" }}>
                    {new Date(b.updated_at).toLocaleDateString("es-MX")}
                  </small>
                </div>

                {parsed.notes && (
                  <p className="muted" style={{ whiteSpace: "pre-wrap", fontSize: 13, marginBottom: 8 }}>
                    {parsed.notes.length > 160 ? parsed.notes.slice(0, 160) + "…" : parsed.notes}
                  </p>
                )}

                {hasReflection && (
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
                    {parsed.insight && <span className="tag">Insight ✓</span>}
                    {parsed.quick_win && <span className="tag">Quick win ✓</span>}
                    {parsed.loose_end && <span className="tag">Duda ✓</span>}
                  </div>
                )}

                <div className="btn-row">
                  <button className="btn btn-ghost btn-sm" onClick={() => startEdit(b)}>
                    Editar
                  </button>
                  <button className="btn btn-danger btn-sm" onClick={() => remove(b)}>
                    Eliminar
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

/* ----------------------------- Materiales ----------------------------- */
function Materiales({ sessionId, userId }: { sessionId: string; userId: string }) {
  const [items, setItems] = useState<DocumentRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from("documents")
      .select("*")
      .eq("session_id", sessionId)
      .order("created_at", { ascending: false });
    if (error) setError(error.message);
    else setItems(data as DocumentRecord[]);
    setLoading(false);
  }, [sessionId]);

  useEffect(() => { load(); }, [load]);

  async function upload(e: FormEvent) {
    e.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file) return;
    setUploading(true);
    setError(null);
    setStatus(`Subiendo "${file.name}"…`);
    try {
      const path = `${userId}/${sessionId}/${Date.now()}-${file.name}`;
      const { error: upErr } = await supabase.storage
        .from(MATERIALS_BUCKET)
        .upload(path, file, { upsert: false, contentType: file.type || undefined });
      if (upErr) throw upErr;

      let contentText: string | null = null;
      if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
        setStatus("Extrayendo texto del PDF…");
        try { contentText = await extractPdfText(file); } catch { contentText = null; }
      }

      const { error: dbErr } = await supabase.from("documents").insert({
        session_id: sessionId,
        user_id: userId,
        name: file.name,
        storage_path: path,
        mime_type: file.type || null,
        size_bytes: file.size,
        content_text: contentText,
      });
      if (dbErr) throw dbErr;

      setStatus(null);
      if (fileRef.current) fileRef.current.value = "";
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al subir el archivo.");
      setStatus(null);
    } finally {
      setUploading(false);
    }
  }

  async function download(doc: DocumentRecord) {
    const { data, error } = await supabase.storage
      .from(MATERIALS_BUCKET)
      .createSignedUrl(doc.storage_path, 60);
    if (error) setError(error.message);
    else if (data?.signedUrl) window.open(data.signedUrl, "_blank");
  }

  async function remove(doc: DocumentRecord) {
    if (!confirm(`¿Eliminar "${doc.name}"?`)) return;
    await supabase.storage.from(MATERIALS_BUCKET).remove([doc.storage_path]);
    const { error } = await supabase.from("documents").delete().eq("id", doc.id);
    if (error) setError(error.message);
    else load();
  }

  return (
    <>
      <div className="card">
        <h2 style={{ marginTop: 0 }}>Cargar material</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          Sube los PDFs de los casos del IPADE, presentaciones y materiales de la
          jornada. El texto de los PDFs se indexa para que el agente pueda usarlo.
        </p>
        {error && <div className="alert alert-error">{error}</div>}
        {status && <div className="alert alert-info">{status}</div>}
        <form onSubmit={upload}>
          <div className="field">
            <input ref={fileRef} type="file" accept=".pdf,.ppt,.pptx,.doc,.docx,.txt,.md" />
          </div>
          <button className="btn btn-gold" disabled={uploading}>
            {uploading ? "Subiendo…" : "Subir archivo"}
          </button>
        </form>
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Materiales de la jornada</h2>
        {loading ? (
          <p>Cargando…</p>
        ) : items.length === 0 ? (
          <p className="muted">Aún no hay materiales cargados.</p>
        ) : (
          items.map((d) => (
            <div key={d.id} className="list-item">
              <div>
                <h3>{d.name}</h3>
                <small>
                  {d.content_text ? <span className="tag">texto indexado</span> : null}{" "}
                  {d.size_bytes ? `${(d.size_bytes / 1024).toFixed(0)} KB · ` : ""}
                  {new Date(d.created_at).toLocaleDateString("es-MX")}
                </small>
              </div>
              <div className="btn-row">
                <button className="btn btn-ghost btn-sm" onClick={() => download(d)}>Ver</button>
                <button className="btn btn-danger btn-sm" onClick={() => remove(d)}>Eliminar</button>
              </div>
            </div>
          ))
        )}
      </div>
    </>
  );
}

/* ----------------------------- Agente ----------------------------- */
function Agente({ sessionId, userId }: { sessionId: string; userId: string }) {
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    supabase
      .from("agent_messages")
      .select("*")
      .eq("session_id", sessionId)
      .order("created_at", { ascending: true })
      .then(({ data, error }) => {
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
    <div className="card">
      <h2 style={{ marginTop: 0 }}>Agente IPADE Companion</h2>
      <p className="muted" style={{ marginTop: 0 }}>
        El agente conoce tu Pasaporte, tus bitácoras y los materiales de esta jornada.
        Pregúntale dudas o cuéntale una iniciativa para que te ayude a planearla según
        el contexto de tu empresa.
      </p>

      {error && <div className="alert alert-error">{error}</div>}

      <div className="chat-log" ref={logRef}>
        {messages.length === 0 && !busy && (
          <div className="bubble assistant">
            Hola, soy tu IPADE Companion. ¿En qué te puedo ayudar con esta jornada?
            Puedes pedirme que resuelva dudas del caso o que te ayude a planear una
            iniciativa considerando la situación de tu empresa.
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
    </div>
  );
}
