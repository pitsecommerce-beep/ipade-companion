import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { supabase } from "../lib/supabase";
import type { StudySession } from "../lib/types";

export default function Dashboard() {
  const { user } = useAuth();
  const [sessions, setSessions] = useState<StudySession[]>([]);
  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasPassport, setHasPassport] = useState<boolean | null>(null);

  async function load() {
    const { data, error } = await supabase
      .from("study_sessions")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) setError(error.message);
    else setSessions(data as StudySession[]);
    setLoading(false);
  }

  useEffect(() => {
    if (!user) return;
    load();
    supabase
      .from("passports")
      .select("id")
      .eq("user_id", user.id)
      .maybeSingle()
      .then(({ data }) => setHasPassport(Boolean(data)));
  }, [user]);

  async function createSession(e: FormEvent) {
    e.preventDefault();
    if (!user || !title.trim()) return;
    setCreating(true);
    setError(null);
    const { error } = await supabase.from("study_sessions").insert({
      user_id: user.id,
      title: title.trim(),
      description: description.trim() || null,
    });
    setCreating(false);
    if (error) {
      setError(error.message);
    } else {
      setTitle("");
      setDescription("");
      load();
    }
  }

  return (
    <>
      <div className="page-head">
        <h1>Mis sesiones</h1>
        <p>
          Crea una sesión por cada caso, módulo o tema del IPADE. Dentro de cada una
          podrás escribir tus bitácoras, cargar materiales y consultar al agente.
        </p>
      </div>

      {hasPassport === false && (
        <div className="alert alert-info">
          Aún no completas tu <strong>Pasaporte IPADE</strong>. Te recomendamos
          llenarlo primero para que el agente conozca tu contexto.{" "}
          <Link to="/pasaporte">Completar Pasaporte →</Link>
        </div>
      )}

      {error && <div className="alert alert-error">{error}</div>}

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Nueva sesión</h2>
        <form onSubmit={createSession}>
          <div className="field">
            <label htmlFor="title">Título</label>
            <input
              id="title"
              placeholder="Ej. Caso Cemex — Estrategia"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
            />
          </div>
          <div className="field">
            <label htmlFor="desc">
              Descripción <span className="hint">— opcional</span>
            </label>
            <input
              id="desc"
              placeholder="Módulo, profesor, fecha…"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <button className="btn btn-gold" disabled={creating}>
            {creating ? "Creando…" : "Crear sesión"}
          </button>
        </form>
      </div>

      <div style={{ marginTop: 24 }}>
        {loading ? (
          <div className="card">Cargando sesiones…</div>
        ) : sessions.length === 0 ? (
          <div className="card muted">
            Todavía no tienes sesiones. Crea la primera arriba.
          </div>
        ) : (
          sessions.map((s) => (
            <div key={s.id} className="list-item">
              <div>
                <h3>{s.title}</h3>
                <small>
                  {s.description ? `${s.description} · ` : ""}
                  {new Date(s.created_at).toLocaleDateString("es-MX", {
                    year: "numeric",
                    month: "short",
                    day: "numeric",
                  })}
                </small>
              </div>
              <Link className="btn btn-ghost btn-sm" to={`/sesion/${s.id}`}>
                Abrir →
              </Link>
            </div>
          ))
        )}
      </div>
    </>
  );
}
