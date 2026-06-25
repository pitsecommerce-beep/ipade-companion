import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { supabase } from "../lib/supabase";
import { generateReport, sendReminder } from "../lib/agent";
import type { Initiative, InitiativeReport, InitiativeStatus } from "../lib/types";

/* ------------------------------------------------------------------ */
/* Columnas del Kanban                                                  */
/* ------------------------------------------------------------------ */
const COLUMNS: { status: InitiativeStatus; label: string; color: string; bg: string }[] = [
  { status: "pendiente",   label: "Pendiente",   color: "#6b7280", bg: "#f9fafb" },
  { status: "en_progreso", label: "En progreso", color: "#2563eb", bg: "#eff6ff" },
  { status: "completada",  label: "Completada",  color: "#16a34a", bg: "#f0fdf4" },
  { status: "diferida",    label: "Diferida",    color: "#d97706", bg: "#fffbeb" },
];

const CATEGORY_BADGE: Record<string, { icon: string; color: string; label: string }> = {
  inmediata: { icon: "⚡", color: "var(--ok)",            label: "Inmediata"  },
  portafolio:{ icon: "🏛", color: "var(--ipade-gold-dark)", label: "Portafolio" },
};

/* ------------------------------------------------------------------ */
/* Página principal                                                     */
/* ------------------------------------------------------------------ */
export default function ActionPlan() {
  const { user } = useAuth();
  const [report, setReport]           = useState<InitiativeReport | null>(null);
  const [initiatives, setInitiatives] = useState<Initiative[]>([]);
  const [loading, setLoading]         = useState(true);
  const [generating, setGenerating]   = useState(false);
  const [error, setError]             = useState<string | null>(null);
  const [reminderTarget, setReminderTarget] = useState<Initiative | null>(null);
  const [view, setView]               = useState<"kanban" | "list">("kanban");

  const load = useCallback(async () => {
    if (!user) return;
    const { data: reports } = await supabase
      .from("initiative_reports")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(1);

    if (reports && reports.length > 0) {
      const r = reports[0] as InitiativeReport;
      setReport(r);
      const { data: inits } = await supabase
        .from("initiatives")
        .select("*")
        .eq("report_id", r.id)
        .order("category");
      setInitiatives((inits as Initiative[]) ?? []);
    }
    setLoading(false);
  }, [user]);

  useEffect(() => { load(); }, [load]);

  async function handleGenerate() {
    setGenerating(true);
    setError(null);
    try {
      const result = await generateReport();
      setReport(result.report);
      setInitiatives(result.initiatives);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al generar el reporte.");
    } finally {
      setGenerating(false);
    }
  }

  async function updateStatus(id: string, status: InitiativeStatus) {
    await supabase
      .from("initiatives")
      .update({ status, updated_at: new Date().toISOString() })
      .eq("id", id);
    setInitiatives((prev) => prev.map((i) => (i.id === id ? { ...i, status } : i)));
  }

  if (loading) return <div className="card">Cargando tu Plan de Acción…</div>;

  return (
    <>
      <div className="page-head">
        <h1>Plan de Acción</h1>
        <p>
          El agente analiza todo lo que has declarado en tu Pasaporte y tus bitácoras
          para ordenar tus iniciativas en dos horizontes claros: lo que puedes mover
          ahora y lo que requiere una planeación más extensa.
        </p>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {!report && !generating && <EmptyState onGenerate={handleGenerate} />}
      {generating && <GeneratingState />}

      {report && !generating && (
        <>
          {/* Barra de controles */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20, flexWrap: "wrap", gap: 12 }}>
            <span className="muted" style={{ fontSize: 13 }}>
              Generado el {new Date(report.created_at).toLocaleDateString("es-MX", {
                year: "numeric", month: "long", day: "numeric",
              })}
            </span>
            <div style={{ display: "flex", gap: 8 }}>
              <ViewToggle view={view} onChange={setView} />
              <button className="btn btn-ghost btn-sm" onClick={handleGenerate}>
                Regenerar
              </button>
            </div>
          </div>

          {initiatives.length === 0 ? (
            <div className="card muted">
              No se encontraron iniciativas. Completa tu Pasaporte y agrega quick wins en tus bitácoras.
            </div>
          ) : view === "kanban" ? (
            <KanbanBoard
              initiatives={initiatives}
              onStatusChange={updateStatus}
              onReminder={setReminderTarget}
            />
          ) : (
            <ListView
              initiatives={initiatives}
              onStatusChange={updateStatus}
              onReminder={setReminderTarget}
            />
          )}
        </>
      )}

      {reminderTarget && user && (
        <ReminderModal
          initiative={reminderTarget}
          userEmail={user.email ?? ""}
          onClose={() => setReminderTarget(null)}
        />
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Toggle de vista                                                      */
/* ------------------------------------------------------------------ */
function ViewToggle({ view, onChange }: { view: "kanban" | "list"; onChange: (v: "kanban" | "list") => void }) {
  const btn = (v: "kanban" | "list", icon: string, label: string) => (
    <button
      onClick={() => onChange(v)}
      style={{
        padding: "4px 12px", fontSize: 12, border: "1px solid var(--line)",
        borderRadius: 6, cursor: "pointer", display: "flex", alignItems: "center", gap: 5,
        background: view === v ? "var(--ipade-navy)" : "#fff",
        color: view === v ? "#fff" : "var(--ink)",
        fontWeight: view === v ? 600 : 400,
      }}
    >
      {icon} {label}
    </button>
  );
  return (
    <div style={{ display: "flex", gap: 4 }}>
      {btn("kanban", "⬛", "Tablero")}
      {btn("list",   "☰",  "Lista")}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Tablero Kanban                                                       */
/* ------------------------------------------------------------------ */
function KanbanBoard({
  initiatives,
  onStatusChange,
  onReminder,
}: {
  initiatives: Initiative[];
  onStatusChange: (id: string, status: InitiativeStatus) => void;
  onReminder: (i: Initiative) => void;
}) {
  const dragging = useRef<string | null>(null);
  const [dragOver, setDragOver] = useState<InitiativeStatus | null>(null);

  function handleDragStart(e: React.DragEvent, id: string) {
    dragging.current = id;
    e.dataTransfer.effectAllowed = "move";
  }

  function handleDrop(e: React.DragEvent, status: InitiativeStatus) {
    e.preventDefault();
    if (dragging.current) {
      onStatusChange(dragging.current, status);
      dragging.current = null;
    }
    setDragOver(null);
  }

  function handleDragOver(e: React.DragEvent, status: InitiativeStatus) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOver(status);
  }

  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
      gap: 16,
      alignItems: "start",
    }}>
      {COLUMNS.map((col) => {
        const cards = initiatives.filter((i) => i.status === col.status);
        const isOver = dragOver === col.status;
        return (
          <div
            key={col.status}
            onDragOver={(e) => handleDragOver(e, col.status)}
            onDragLeave={() => setDragOver(null)}
            onDrop={(e) => handleDrop(e, col.status)}
            style={{
              background: isOver ? col.bg : "#f8f9fb",
              border: `2px solid ${isOver ? col.color : "var(--line)"}`,
              borderRadius: 10,
              minHeight: 280,
              transition: "border-color .15s, background .15s",
            }}
          >
            {/* Cabecera de columna */}
            <div style={{
              padding: "10px 14px",
              borderBottom: `2px solid ${col.color}`,
              display: "flex", alignItems: "center", gap: 8,
            }}>
              <span style={{
                width: 10, height: 10, borderRadius: "50%",
                background: col.color, display: "inline-block", flexShrink: 0,
              }} />
              <span style={{ fontWeight: 700, fontSize: 13, color: col.color }}>
                {col.label}
              </span>
              <span style={{
                marginLeft: "auto", background: col.color, color: "#fff",
                borderRadius: 10, fontSize: 11, padding: "1px 7px", fontWeight: 600,
              }}>
                {cards.length}
              </span>
            </div>

            {/* Cards */}
            <div style={{ padding: "10px 10px", display: "grid", gap: 8 }}>
              {cards.map((i) => (
                <KanbanCard
                  key={i.id}
                  initiative={i}
                  onDragStart={handleDragStart}
                  onReminder={onReminder}
                />
              ))}
              {cards.length === 0 && (
                <p style={{ fontSize: 12, color: "var(--muted)", textAlign: "center", padding: "20px 0", margin: 0 }}>
                  Arrastra aquí
                </p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Tarjeta del Kanban                                                   */
/* ------------------------------------------------------------------ */
function KanbanCard({
  initiative,
  onDragStart,
  onReminder,
}: {
  initiative: Initiative;
  onDragStart: (e: React.DragEvent, id: string) => void;
  onReminder: (i: Initiative) => void;
}) {
  const badge = CATEGORY_BADGE[initiative.category];
  return (
    <div
      draggable
      onDragStart={(e) => onDragStart(e, initiative.id)}
      style={{
        background: "#fff",
        border: "1px solid var(--line)",
        borderRadius: 8,
        padding: "12px 13px",
        cursor: "grab",
        boxShadow: "0 1px 3px rgba(0,0,0,.06)",
        userSelect: "none",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 6, marginBottom: 6 }}>
        <span style={{
          fontSize: 11, fontWeight: 700, color: badge.color,
          background: badge.color === "var(--ok)" ? "#e7f5ee" : "rgba(200,165,91,.15)",
          borderRadius: 5, padding: "2px 7px", whiteSpace: "nowrap",
        }}>
          {badge.icon} {badge.label}
        </span>
        <span style={{
          fontSize: 10, color: "var(--muted)", background: "#f3f4f6",
          borderRadius: 4, padding: "2px 6px", whiteSpace: "nowrap",
        }}>
          {initiative.source === "bitacora" ? "Bitácora" : "Pasaporte"}
        </span>
      </div>

      <p style={{ margin: "0 0 6px", fontWeight: 600, fontSize: 13, lineHeight: 1.4 }}>
        {initiative.title}
      </p>
      <p style={{ margin: "0 0 10px", fontSize: 12, color: "var(--muted)", lineHeight: 1.5 }}>
        {initiative.description}
      </p>

      <button
        className="btn btn-ghost btn-sm"
        style={{ fontSize: 11, padding: "3px 8px" }}
        onClick={() => onReminder(initiative)}
      >
        ✉ Recordatorio
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Vista de lista (original, compacta)                                  */
/* ------------------------------------------------------------------ */
function ListView({
  initiatives,
  onStatusChange,
  onReminder,
}: {
  initiatives: Initiative[];
  onStatusChange: (id: string, status: InitiativeStatus) => void;
  onReminder: (i: Initiative) => void;
}) {
  const inmediatas = initiatives.filter((i) => i.category === "inmediata");
  const portafolio = initiatives.filter((i) => i.category === "portafolio");

  const section = (
    items: Initiative[],
    title: string,
    subtitle: string,
    accentColor: string,
    emptyMsg: string,
  ) => (
    <section>
      <div style={{
        display: "flex", alignItems: "center", gap: 12, marginBottom: 12,
        paddingBottom: 10, borderBottom: `2px solid ${accentColor}`,
      }}>
        <span style={{
          background: accentColor === "var(--ok)" ? "#e7f5ee" : "rgba(200,165,91,0.15)",
          color: accentColor === "var(--ok)" ? accentColor : "var(--ipade-gold-dark)",
          borderRadius: 8, padding: "4px 12px", fontWeight: 700, fontSize: 13,
        }}>{title}</span>
        <span className="muted" style={{ fontSize: 13 }}>{subtitle}</span>
      </div>
      {items.length === 0
        ? <p className="muted">{emptyMsg}</p>
        : <div style={{ display: "grid", gap: 12 }}>
            {items.map((i) => (
              <ListCard key={i.id} initiative={i} accentColor={accentColor}
                onStatusChange={onStatusChange} onReminder={() => onReminder(i)} />
            ))}
          </div>
      }
    </section>
  );

  return (
    <div style={{ display: "grid", gap: 28 }}>
      {section(inmediatas, "⚡ Iniciativas Inmediatas", "Implementables en semanas · pocos recursos",
        "var(--ok)", "El agente no identificó iniciativas inmediatas en esta iteración.")}
      <div style={{ textAlign: "center", padding: "4px 0", color: "var(--muted)", fontSize: 12, letterSpacing: "1px" }}>
        · · ·
      </div>
      {section(portafolio, "🏛 Portafolio de Iniciativas", "Meses de implementación · múltiples áreas o presupuesto",
        "var(--ipade-gold)", "No se identificaron iniciativas de portafolio en esta iteración.")}
    </div>
  );
}

function ListCard({
  initiative, accentColor, onStatusChange, onReminder,
}: {
  initiative: Initiative;
  accentColor: string;
  onStatusChange: (id: string, s: InitiativeStatus) => void;
  onReminder: () => void;
}) {
  const STATUS_LABELS: Record<string, string> = {
    pendiente: "Pendiente", en_progreso: "En progreso",
    completada: "Completada", diferida: "Diferida",
  };
  return (
    <div className="card" style={{ borderLeft: `4px solid ${accentColor}`, padding: "16px 18px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <h3 style={{ margin: 0, fontSize: 16, flex: 1 }}>{initiative.title}</h3>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span className="tag" style={{ fontSize: 11 }}>
            {initiative.source === "bitacora" ? "Bitácora" : "Pasaporte"}
          </span>
          <select
            value={initiative.status}
            onChange={(e) => onStatusChange(initiative.id, e.target.value as InitiativeStatus)}
            style={{
              fontSize: 12, padding: "3px 8px", borderRadius: 6,
              border: "1px solid var(--line)", background: "#fff", color: "var(--ink)",
            }}
          >
            {Object.entries(STATUS_LABELS).map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </select>
        </div>
      </div>
      <p style={{ margin: "10px 0 12px", color: "var(--muted)", fontSize: 14, lineHeight: 1.6 }}>
        {initiative.description}
      </p>
      <button className="btn btn-ghost btn-sm" onClick={onReminder}>
        ✉ Programar recordatorio
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Estado vacío                                                         */
/* ------------------------------------------------------------------ */
function EmptyState({ onGenerate }: { onGenerate: () => void }) {
  return (
    <div className="card" style={{ textAlign: "center", padding: "48px 32px", borderTop: "4px solid var(--ipade-gold)" }}>
      <div style={{ fontSize: 40, marginBottom: 16 }}>📋</div>
      <h2 style={{ marginTop: 0 }}>Genera tu Plan de Acción</h2>
      <p style={{ color: "var(--muted)", maxWidth: 500, margin: "0 auto 24px" }}>
        El agente revisará tu Pasaporte y todas tus bitácoras para identificar,
        ordenar y clasificar las iniciativas que has declarado querer llevar a cabo.
      </p>
      <p className="muted" style={{ fontSize: 13, marginBottom: 24 }}>
        Para mejores resultados, completa primero tu Pasaporte IPADE.{" "}
        <Link to="/pasaporte">Ir al Pasaporte →</Link>
      </p>
      <button className="btn btn-primary" style={{ padding: "12px 28px" }} onClick={onGenerate}>
        Generar mi Plan de Acción
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Estado de generación                                                 */
/* ------------------------------------------------------------------ */
function GeneratingState() {
  return (
    <div className="card" style={{ textAlign: "center", padding: "48px 32px" }}>
      <div style={{ display: "flex", justifyContent: "center", marginBottom: 20 }}>
        <div className="spinner" style={{ width: 32, height: 32, border: "3px solid var(--line)", borderTopColor: "var(--ipade-navy)" }} />
      </div>
      <h2 style={{ marginTop: 0 }}>Analizando tus iniciativas…</h2>
      <p style={{ color: "var(--muted)", maxWidth: 400, margin: "0 auto" }}>
        El agente está revisando tu Pasaporte y tus bitácoras. Esto puede tomar unos segundos.
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Modal de recordatorio                                                */
/* ------------------------------------------------------------------ */
function ReminderModal({
  initiative, userEmail, onClose,
}: {
  initiative: Initiative;
  userEmail: string;
  onClose: () => void;
}) {
  const { user } = useAuth();
  const [emailTo, setEmailTo] = useState(userEmail);
  const [subject, setSubject] = useState(initiative.email_subject || `Recordatorio: ${initiative.title}`);
  const [body, setBody]       = useState(initiative.email_body || "");
  const [sending, setSending] = useState(false);
  const [sent, setSent]       = useState(false);
  const [error, setError]     = useState<string | null>(null);

  async function handleSend() {
    if (!user) return;
    setSending(true);
    setError(null);
    try {
      const { data: reminder, error: insertErr } = await supabase
        .from("email_reminders")
        .insert({ user_id: user.id, initiative_id: initiative.id, email_to: emailTo, subject, body, status: "pendiente" })
        .select("id")
        .single();
      if (insertErr || !reminder) throw new Error(insertErr?.message ?? "Error al guardar.");
      await sendReminder(reminder.id);
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al enviar.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", display: "grid", placeItems: "center", zIndex: 100, padding: 20 }}>
      <div className="card" style={{ width: "100%", maxWidth: 520, maxHeight: "90vh", overflow: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
          <h2 style={{ margin: 0, fontSize: 18 }}>Recordatorio por correo</h2>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>✕</button>
        </div>
        <p className="muted" style={{ fontSize: 13, marginBottom: 20 }}>
          Iniciativa: <strong>{initiative.title}</strong>
        </p>

        {sent ? (
          <div>
            <div className="alert alert-ok">✓ Correo enviado correctamente a <strong>{emailTo}</strong>.</div>
            <button className="btn btn-ghost btn-sm" onClick={onClose}>Cerrar</button>
          </div>
        ) : (
          <>
            {error && <div className="alert alert-error">{error}</div>}
            <div className="field">
              <label htmlFor="r-to">Enviar a</label>
              <input id="r-to" type="email" value={emailTo} onChange={(e) => setEmailTo(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="r-subject">Asunto</label>
              <input id="r-subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="r-body">
                Mensaje <span className="hint">— generado por el agente, puedes editarlo</span>
              </label>
              <textarea id="r-body" style={{ minHeight: 160 }} value={body} onChange={(e) => setBody(e.target.value)} />
            </div>
            <div className="btn-row">
              <button className="btn btn-primary" onClick={handleSend} disabled={sending || !emailTo || !subject}>
                {sending ? "Enviando…" : "Enviar ahora"}
              </button>
              <button className="btn btn-ghost" onClick={onClose}>Cancelar</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
