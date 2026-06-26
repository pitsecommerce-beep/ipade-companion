import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { supabase, MATERIALS_BUCKET } from "../lib/supabase";
import { extractPdfText } from "../lib/pdf";
import { askAgent } from "../lib/agent";
import type { AgentMessage, Bitacora, DocumentRecord, StudySession } from "../lib/types";

type Tab = "bitacoras" | "materiales" | "agente";

/**
 * Convierte un nombre de archivo en una key válida para Supabase Storage:
 * quita acentos/diacríticos, reemplaza espacios y caracteres no permitidos por
 * guiones, y conserva la extensión. Evita el error 400 "Invalid key".
 */
function sanitizeStorageKey(filename: string): string {
  const dot = filename.lastIndexOf(".");
  const base = dot > 0 ? filename.slice(0, dot) : filename;
  const ext = dot > 0 ? filename.slice(dot + 1) : "";

  const clean = (s: string) =>
    s
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "") // elimina diacríticos (í → i, ñ → n)
      .replace(/[^a-zA-Z0-9._-]+/g, "-") // resto → guion
      .replace(/-+/g, "-")
      .replace(/^[-.]+|[-.]+$/g, "");

  const safeBase = clean(base) || "archivo";
  const safeExt = clean(ext).toLowerCase();
  return safeExt ? `${safeBase}.${safeExt}` : safeBase;
}

interface BitacoraContent {
  notes: string;   // HTML desde el editor enriquecido
  insight: string;
  quick_win: string;
  loose_end: string;
}

const EMPTY_CONTENT: BitacoraContent = { notes: "", insight: "", quick_win: "", loose_end: "" };

function parseContent(raw: string): BitacoraContent {
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed === "object" && parsed !== null && "notes" in parsed) {
      return { ...EMPTY_CONTENT, ...parsed };
    }
  } catch { /* legacy plain text */ }
  return { ...EMPTY_CONTENT, notes: raw };
}

function serializeContent(c: BitacoraContent): string {
  return JSON.stringify(c);
}

/** Extrae texto plano de HTML para el preview en la lista */
function htmlToText(html: string): string {
  const div = document.createElement("div");
  div.innerHTML = html;
  return div.textContent ?? "";
}

/* ===================================================================== */
/* Editor enriquecido — toolbar + contentEditable                         */
/* ===================================================================== */
const HIGHLIGHTS = ["#fef08a", "#bbf7d0", "#bfdbfe", "#fecaca", ""];

function RichTextEditor({
  editorKey,
  initialValue,
  onChange,
  placeholder,
  minHeight = 300,
}: {
  editorKey: string;
  initialValue: string;
  onChange: (html: string) => void;
  placeholder?: string;
  minHeight?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [activeHighlight, setActiveHighlight] = useState("");

  // Inicializar contenido al montar o al cambiar el editorKey (nueva bitácora / edición)
  useEffect(() => {
    if (ref.current) {
      ref.current.innerHTML = initialValue;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editorKey]);

  function exec(command: string, value?: string) {
    ref.current?.focus();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (document as any).execCommand(command, false, value ?? undefined);
    if (ref.current) onChange(ref.current.innerHTML);
  }

  function highlight(color: string) {
    setActiveHighlight(color);
    exec("hiliteColor", color || "transparent");
  }

  const btnBase: React.CSSProperties = {
    border: "1px solid var(--line)", borderRadius: 4, padding: "3px 8px",
    fontSize: 13, cursor: "pointer", background: "#fff", color: "var(--ink)",
    lineHeight: 1.4, display: "inline-flex", alignItems: "center", justifyContent: "center",
  };

  return (
    <div style={{ border: "1px solid var(--line)", borderRadius: 8, overflow: "hidden", background: "#fff" }}>
      {/* Barra de herramientas */}
      <div style={{
        display: "flex", flexWrap: "wrap", gap: 4, padding: "6px 10px",
        background: "#f8f9fb", borderBottom: "1px solid var(--line)",
      }}>
        <button type="button" title="Negrita (Ctrl+B)" style={{ ...btnBase, fontWeight: "bold" }} onClick={() => exec("bold")}>B</button>
        <button type="button" title="Cursiva (Ctrl+I)"   style={{ ...btnBase, fontStyle: "italic" }} onClick={() => exec("italic")}>I</button>
        <button type="button" title="Subrayado (Ctrl+U)" style={{ ...btnBase, textDecoration: "underline" }} onClick={() => exec("underline")}>U</button>
        <button type="button" title="Tachado"            style={{ ...btnBase, textDecoration: "line-through" }} onClick={() => exec("strikeThrough")}>S</button>

        <span style={{ width: 1, background: "var(--line)", margin: "0 4px" }} />

        <button type="button" title="Encabezado 1" style={{ ...btnBase, fontFamily: "Georgia, serif", fontWeight: 700 }}
          onClick={() => exec("formatBlock", "H2")}>H1</button>
        <button type="button" title="Encabezado 2" style={{ ...btnBase, fontFamily: "Georgia, serif", fontWeight: 700, fontSize: 11 }}
          onClick={() => exec("formatBlock", "H3")}>H2</button>
        <button type="button" title="Párrafo normal" style={{ ...btnBase, fontSize: 11 }}
          onClick={() => exec("formatBlock", "P")}>¶</button>

        <span style={{ width: 1, background: "var(--line)", margin: "0 4px" }} />

        <button type="button" title="Lista con viñetas" style={btnBase} onClick={() => exec("insertUnorderedList")}>• Lista</button>
        <button type="button" title="Lista numerada"    style={btnBase} onClick={() => exec("insertOrderedList")}>1. Lista</button>

        <span style={{ width: 1, background: "var(--line)", margin: "0 4px" }} />

        {/* Colores de resaltado */}
        <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
          <span style={{ fontSize: 11, color: "var(--muted)" }}>Resaltar:</span>
          {HIGHLIGHTS.map((c) => (
            <button
              key={c || "none"}
              type="button"
              title={c ? `Resaltar (${c})` : "Quitar resaltado"}
              onClick={() => highlight(c)}
              style={{
                ...btnBase,
                width: 20, height: 20, padding: 0,
                background: c || "#fff",
                border: c === activeHighlight ? "2px solid var(--ipade-navy)" : "1px solid var(--line)",
                boxSizing: "border-box",
              }}
            >
              {!c && <span style={{ fontSize: 10, lineHeight: 1 }}>x</span>}
            </button>
          ))}
        </span>

        <span style={{ width: 1, background: "var(--line)", margin: "0 4px" }} />

        <button type="button" title="Quitar formato" style={{ ...btnBase, fontSize: 11, color: "var(--muted)" }}
          onClick={() => exec("removeFormat")}>
          A/ Limpiar
        </button>
      </div>

      {/* Área editable */}
      <div
        ref={ref}
        contentEditable
        suppressContentEditableWarning
        data-placeholder={placeholder}
        onInput={() => { if (ref.current) onChange(ref.current.innerHTML); }}
        style={{
          minHeight,
          padding: "16px 20px",
          fontSize: 14,
          lineHeight: 1.75,
          outline: "none",
          fontFamily: '"Inter", "Segoe UI", sans-serif',
          color: "var(--ink)",
          background: "#fafbfc",
          overflowY: "auto",
        }}
      />

      <style>{`
        [contenteditable]:empty:before {
          content: attr(data-placeholder);
          color: var(--muted);
          pointer-events: none;
        }
        [contenteditable] h2 { font-family: 'Playfair Display', Georgia, serif; font-size: 18px; margin: 12px 0 6px; color: var(--ipade-navy); }
        [contenteditable] h3 { font-size: 15px; margin: 10px 0 4px; color: var(--ipade-navy); }
        [contenteditable] ul, [contenteditable] ol { padding-left: 22px; margin: 6px 0; }
        [contenteditable] li { margin-bottom: 3px; }
        [contenteditable] p  { margin: 4px 0; }
      `}</style>
    </div>
  );
}

/* ===================================================================== */
/* Página principal                                                        */
/* ===================================================================== */
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
        <Link to="/" className="muted" style={{ fontSize: 13 }}>← Mis jornadas</Link>
        <h1 style={{ marginTop: 6 }}>{session.title}</h1>
        {session.description && <p>{session.description}</p>}
      </div>

      <div className="tabs">
        <button className={tab === "bitacoras" ? "active" : ""} onClick={() => setTab("bitacoras")}>Bitácoras</button>
        <button className={tab === "materiales" ? "active" : ""} onClick={() => setTab("materiales")}>Materiales</button>
        <button className={tab === "agente"    ? "active" : ""} onClick={() => setTab("agente")}>Agente</button>
      </div>

      {tab === "bitacoras" && <Bitacoras sessionId={id} userId={user.id} />}
      {tab === "materiales" && <Materiales sessionId={id} userId={user.id} />}
      {tab === "agente"    && <Agente sessionId={id} userId={user.id} />}
    </>
  );
}

/* ===================================================================== */
/* Bitácoras                                                               */
/* ===================================================================== */
function Bitacoras({ sessionId, userId }: { sessionId: string; userId: string }) {
  const [items, setItems]     = useState<Bitacora[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Bitacora | null>(null);
  const [title, setTitle]     = useState("");
  const [body, setBody]       = useState<BitacoraContent>(EMPTY_CONTENT);
  const [editorKey, setEditorKey] = useState("new");   // force remount on edit
  const [saving, setSaving]   = useState(false);
  const [error, setError]     = useState<string | null>(null);

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
    setEditorKey(`new-${Date.now()}`);
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
    const parsed = parseContent(b.content);
    setBody(parsed);
    setEditorKey(`edit-${b.id}`);
  }

  return (
    /* Layout: formulario ocupa todo el ancho disponible; lista debajo en pantallas medianas,
       a la derecha en pantallas grandes */
    <div style={{
      display: "grid",
      gap: 24,
      gridTemplateColumns: "minmax(0,2fr) minmax(260px,1fr)",
    }}>
      {/* ── Formulario (izquierda / arriba) ── */}
      <div>
        {error && <div className="alert alert-error">{error}</div>}

        <form onSubmit={save}>
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="field" style={{ marginBottom: 0 }}>
              <label htmlFor="b-title">{editing ? "Editando bitácora" : "Nueva bitácora"}</label>
              <input
                id="b-title"
                placeholder="Ej. Sesión de la mañana — Caso Cemex"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
              />
            </div>
          </div>

          {/* Notas — editor enriquecido */}
          <div className="card" style={{ marginBottom: 16 }}>
            <h3 style={{ marginTop: 0, marginBottom: 4, fontSize: 15, color: "var(--ipade-navy)" }}>
              Notas de la sesión
            </h3>
            <p className="muted" style={{ fontSize: 12, marginTop: 0, marginBottom: 10 }}>
              Para tomar durante la sesión — apuntes libres, ideas, referencias.
            </p>
            <RichTextEditor
              editorKey={editorKey}
              initialValue={body.notes}
              onChange={(html) => setBody((b) => ({ ...b, notes: html }))}
              placeholder="Escribe aquí tus apuntes, ideas y referencias mientras transcurre la sesión…"
              minHeight={320}
            />
          </div>

          {/* Reflexión posterior */}
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
              <button type="button" className="btn btn-ghost" onClick={reset}>Cancelar</button>
            )}
          </div>
        </form>
      </div>

      {/* ── Lista (derecha / abajo) ── */}
      <div>
        <h2 style={{ marginTop: 0, fontSize: 18 }}>Bitácoras de esta jornada</h2>
        {loading ? (
          <div className="card">Cargando…</div>
        ) : items.length === 0 ? (
          <div className="card muted">Aún no hay bitácoras en esta jornada.</div>
        ) : (
          items.map((b) => {
            const parsed = parseContent(b.content);
            const preview = htmlToText(parsed.notes);
            const hasReflection = parsed.insight || parsed.quick_win || parsed.loose_end;
            return (
              <div key={b.id} className="card" style={{ padding: 16, marginBottom: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10, marginBottom: 8 }}>
                  <h3 style={{ margin: 0, fontSize: 15 }}>{b.title}</h3>
                  <small className="muted" style={{ whiteSpace: "nowrap" }}>
                    {new Date(b.updated_at).toLocaleDateString("es-MX")}
                  </small>
                </div>
                {preview && (
                  <p className="muted" style={{ fontSize: 13, marginBottom: 8 }}>
                    {preview.length > 140 ? preview.slice(0, 140) + "…" : preview}
                  </p>
                )}
                {hasReflection && (
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
                    {parsed.insight   && <span className="tag">Insight</span>}
                    {parsed.quick_win && <span className="tag">Quick win</span>}
                    {parsed.loose_end && <span className="tag">Duda</span>}
                  </div>
                )}
                <div className="btn-row">
                  <button className="btn btn-ghost btn-sm" onClick={() => startEdit(b)}>Editar</button>
                  <button className="btn btn-danger btn-sm" onClick={() => remove(b)}>Eliminar</button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

/* ===================================================================== */
/* Materiales                                                              */
/* ===================================================================== */
function Materiales({ sessionId, userId }: { sessionId: string; userId: string }) {
  const [items, setItems]       = useState<DocumentRecord[]>([]);
  const [loading, setLoading]   = useState(true);
  const [uploading, setUploading] = useState(false);
  const [status, setStatus]     = useState<string | null>(null);
  const [error, setError]       = useState<string | null>(null);
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
      // La key de Storage no admite acentos, espacios ni caracteres especiales
      // (Supabase responde 400 "Invalid key"). Sanitizamos sólo la ruta; el
      // nombre original se conserva en la columna `name` para mostrarlo.
      const path = `${userId}/${sessionId}/${Date.now()}-${sanitizeStorageKey(file.name)}`;
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
        session_id: sessionId, user_id: userId, name: file.name,
        storage_path: path, mime_type: file.type || null,
        size_bytes: file.size, content_text: contentText,
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
    const { data, error } = await supabase.storage.from(MATERIALS_BUCKET).createSignedUrl(doc.storage_path, 60);
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
          Sube los PDFs de los casos del IPADE, presentaciones y materiales de la jornada.
          El texto de los PDFs se indexa para que el agente pueda usarlo.
        </p>
        {error && <div className="alert alert-error">{error}</div>}
        {status && <div className="alert alert-info">{status}</div>}
        <form onSubmit={upload}>
          <div className="field">
            <input ref={fileRef} type="file" accept=".pdf,.ppt,.pptx,.doc,.docx,.txt,.md" />
          </div>
          <button className="btn btn-gold" disabled={uploading}>{uploading ? "Subiendo…" : "Subir archivo"}</button>
        </form>
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Materiales de la jornada</h2>
        {loading ? <p>Cargando…</p> : items.length === 0 ? (
          <p className="muted">Aún no hay materiales cargados.</p>
        ) : items.map((d) => (
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
        ))}
      </div>
    </>
  );
}

/* ===================================================================== */
/* Agente                                                                  */
/* ===================================================================== */
function Agente({ sessionId, userId }: { sessionId: string; userId: string }) {
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [input, setInput]       = useState("");
  const [busy, setBusy]         = useState(false);
  const [error, setError]       = useState<string | null>(null);
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
      id: `tmp-${Date.now()}`, user_id: userId, session_id: sessionId,
      role: "user", content: text, created_at: new Date().toISOString(),
    };
    setMessages((m) => [...m, userMsg]);
    await supabase.from("agent_messages")
      .insert({ session_id: sessionId, user_id: userId, role: "user", content: text });

    try {
      const history = messages.map((m) => ({ role: m.role, content: m.content }));
      const reply = await askAgent({ sessionId, message: text, history });
      const botMsg: AgentMessage = {
        id: `tmp-bot-${Date.now()}`, user_id: userId, session_id: sessionId,
        role: "assistant", content: reply, created_at: new Date().toISOString(),
      };
      setMessages((m) => [...m, botMsg]);
      await supabase.from("agent_messages")
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
        Pregúntale dudas o cuéntale una iniciativa para que te ayude a planearla.
      </p>
      {error && <div className="alert alert-error">{error}</div>}
      <div className="chat-log" ref={logRef}>
        {messages.length === 0 && !busy && (
          <div className="bubble assistant">
            Hola, soy tu IPADE Companion. ¿En qué te puedo ayudar con esta jornada?
          </div>
        )}
        {messages.map((m) => <div key={m.id} className={`bubble ${m.role}`}>{m.content}</div>)}
        {busy && <div className="bubble assistant">Pensando…</div>}
      </div>
      <form className="chat-input" onSubmit={send}>
        <textarea
          value={input}
          placeholder="Escribe tu mensaje…  (Enter para enviar, Shift+Enter para salto de línea)"
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(e); } }}
        />
        <button className="btn btn-primary" disabled={busy || !input.trim()}>
          {busy ? <span className="spinner" /> : "Enviar"}
        </button>
      </form>
    </div>
  );
}
