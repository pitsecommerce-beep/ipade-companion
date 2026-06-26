import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { supabase, MATERIALS_BUCKET } from "../lib/supabase";
import { extractPdfText } from "../lib/pdf";
import AgentChat from "../components/AgentChat";
import type { Bitacora, DocumentRecord, StudySession } from "../lib/types";

type Tab = "bitacoras" | "materiales" | "agente";

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
  if (!session) return <div className="card">Cargando sesión…</div>;
  if (!user) return null;

  return (
    <>
      <div className="page-head">
        <Link to="/" className="muted" style={{ fontSize: 13 }}>
          ← Mis sesiones
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
  const [content, setContent] = useState("");
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

  useEffect(() => {
    load();
  }, [load]);

  function reset() {
    setEditing(null);
    setTitle("");
    setContent("");
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setSaving(true);
    setError(null);
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
    else {
      reset();
      load();
    }
  }

  async function remove(b: Bitacora) {
    if (!confirm(`¿Eliminar la bitácora "${b.title}"?`)) return;
    const { error } = await supabase.from("bitacoras").delete().eq("id", b.id);
    if (error) setError(error.message);
    else {
      if (editing?.id === b.id) reset();
      load();
    }
  }

  return (
    <div className="grid" style={{ gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)" }}>
      <div className="card">
        <h2 style={{ marginTop: 0 }}>{editing ? "Editar bitácora" : "Nueva bitácora"}</h2>
        {error && <div className="alert alert-error">{error}</div>}
        <form onSubmit={save}>
          <div className="field">
            <label htmlFor="b-title">Título</label>
            <input id="b-title" value={title} onChange={(e) => setTitle(e.target.value)} required />
          </div>
          <div className="field">
            <label htmlFor="b-content">Notas</label>
            <textarea
              id="b-content"
              style={{ minHeight: 220 }}
              placeholder="Tus apuntes, aprendizajes y preguntas de esta sesión…"
              value={content}
              onChange={(e) => setContent(e.target.value)}
            />
          </div>
          <div className="btn-row">
            <button className="btn btn-primary" disabled={saving}>
              {saving ? "Guardando…" : editing ? "Actualizar" : "Guardar bitácora"}
            </button>
            {editing && (
              <button type="button" className="btn btn-ghost" onClick={reset}>
                Cancelar
              </button>
            )}
          </div>
        </form>
      </div>

      <div>
        <h2 style={{ marginTop: 0 }}>Bitácoras de la sesión</h2>
        {loading ? (
          <div className="card">Cargando…</div>
        ) : items.length === 0 ? (
          <div className="card muted">Aún no hay bitácoras en esta sesión.</div>
        ) : (
          items.map((b) => (
            <div key={b.id} className="card" style={{ padding: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                <h3 style={{ margin: 0, fontSize: 16 }}>{b.title}</h3>
                <small className="muted">
                  {new Date(b.updated_at).toLocaleDateString("es-MX")}
                </small>
              </div>
              {b.content && (
                <p className="muted" style={{ whiteSpace: "pre-wrap", marginBottom: 8 }}>
                  {b.content.length > 240 ? b.content.slice(0, 240) + "…" : b.content}
                </p>
              )}
              <div className="btn-row">
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => {
                    setEditing(b);
                    setTitle(b.title);
                    setContent(b.content);
                  }}
                >
                  Editar
                </button>
                <button className="btn btn-danger btn-sm" onClick={() => remove(b)}>
                  Eliminar
                </button>
              </div>
            </div>
          ))
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

  useEffect(() => {
    load();
  }, [load]);

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

      // Extrae texto de PDFs para que el agente pueda consultarlo.
      let contentText: string | null = null;
      if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
        setStatus("Extrayendo texto del PDF…");
        try {
          contentText = await extractPdfText(file);
        } catch {
          contentText = null; // si falla, conservamos el archivo igualmente
        }
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
          sesión. El texto de los PDFs se indexa para que el agente pueda usarlo.
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
        <h2 style={{ marginTop: 0 }}>Materiales de la sesión</h2>
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
                <button className="btn btn-ghost btn-sm" onClick={() => download(d)}>
                  Ver
                </button>
                <button className="btn btn-danger btn-sm" onClick={() => remove(d)}>
                  Eliminar
                </button>
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
  return (
    <div className="card">
      <h2 style={{ marginTop: 0 }}>Agente IPADE Companion</h2>
      <p className="muted" style={{ marginTop: 0 }}>
        El agente conoce tu Pasaporte, tus bitácoras y los materiales de esta sesión.
        Pregúntale dudas o cuéntale una iniciativa para que te ayude a planearla según
        el contexto de tu empresa.
      </p>
      <AgentChat
        sessionId={sessionId}
        userId={userId}
        intro="Hola, soy tu IPADE Companion. ¿En qué te puedo ayudar con esta sesión? Puedes pedirme que resuelva dudas del caso o que te ayude a planear una iniciativa considerando la situación de tu empresa."
      />
    </div>
  );
}
