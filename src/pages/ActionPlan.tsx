import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { supabase } from "../lib/supabase";
import { generateReport, sendReminder } from "../lib/agent";
import type { Initiative, InitiativeReport, InitiativeStatus } from "../lib/types";

/* ------------------------------------------------------------------ */
/* Constantes                                                           */
/* ------------------------------------------------------------------ */
const COLUMNS: { status: InitiativeStatus; label: string; color: string; bg: string }[] = [
  { status: "pendiente",   label: "Pendiente",   color: "#6b7280", bg: "#f9fafb" },
  { status: "en_progreso", label: "En progreso", color: "#2563eb", bg: "#eff6ff" },
  { status: "completada",  label: "Completada",  color: "#16a34a", bg: "#f0fdf4" },
  { status: "diferida",    label: "Diferida",    color: "#d97706", bg: "#fffbeb" },
];

const CATEGORY_BADGE = {
  inmediata:  { icon: "⚡", color: "#16a34a", bgColor: "#dcfce7", label: "Inmediata"  },
  portafolio: { icon: "🏛", color: "#92400e", bgColor: "#fef3c7", label: "Portafolio" },
};

/** Fecha sugerida de recordatorio según categoría */
function suggestedDate(category: string): string {
  const d = new Date();
  d.setDate(d.getDate() + (category === "inmediata" ? 14 : 90));
  return d.toISOString().slice(0, 10);
}

/* ------------------------------------------------------------------ */
/* PDF — abre ventana con kanban membretado y dispara impresión        */
/* ------------------------------------------------------------------ */
function printKanban(initiatives: Initiative[], reportDate: string) {
  const cols = COLUMNS.map((c) => ({
    ...c,
    cards: initiatives.filter((i) => i.status === c.status),
  }));

  const cardHtml = (i: Initiative) => {
    const b = CATEGORY_BADGE[i.category as keyof typeof CATEGORY_BADGE] ?? CATEGORY_BADGE.inmediata;
    return `<div class="card">
      <span class="badge" style="background:${b.bgColor};color:${b.color}">${b.icon} ${b.label}</span>
      <div class="card-title">${i.title}</div>
      <div class="card-desc">${i.description}</div>
    </div>`;
  };

  const colHtml = cols.map((c) => `
    <div class="col">
      <div class="col-head" style="border-color:${c.color};color:${c.color}">
        <span class="dot" style="background:${c.color}"></span>${c.label}
        <span class="count" style="background:${c.color}">${c.cards.length}</span>
      </div>
      <div class="cards">${c.cards.map(cardHtml).join("") || '<p class="empty">—</p>'}</div>
    </div>`).join("");

  const html = `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8">
<title>Plan de Acción — IPADE Companion</title>
<style>
  @page { size: A4 landscape; margin: 12mm 14mm; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 11px; color: #1a1a2e; background: #fff; }
  .header { display:flex; align-items:center; gap:14px; padding-bottom:10px; border-bottom:3px solid #002855; margin-bottom:14px; }
  .logo { width:40px; height:40px; border-radius:8px; background:#002855; padding:4px; }
  .header-text h1 { font-size:16px; color:#002855; font-family:Georgia,serif; }
  .header-text p  { font-size:10px; color:#6b7280; margin-top:2px; }
  .board { display:grid; grid-template-columns:repeat(4,1fr); gap:10px; height:calc(100% - 80px); }
  .col { display:flex; flex-direction:column; border:1.5px solid #e5e7eb; border-radius:8px; overflow:hidden; }
  .col-head { display:flex; align-items:center; gap:6px; padding:7px 10px; font-weight:700; font-size:11px; border-bottom:2.5px solid; background:#fafafa; }
  .dot { width:8px; height:8px; border-radius:50%; flex-shrink:0; }
  .count { margin-left:auto; border-radius:10px; font-size:10px; padding:1px 6px; color:#fff; font-weight:700; }
  .cards { padding:8px; display:flex; flex-direction:column; gap:6px; flex:1; }
  .card { border:1px solid #e5e7eb; border-radius:6px; padding:8px 9px; background:#fff; }
  .badge { font-size:9px; font-weight:700; border-radius:4px; padding:2px 6px; display:inline-block; margin-bottom:5px; }
  .card-title { font-weight:700; font-size:11px; line-height:1.4; margin-bottom:4px; color:#1a1a2e; }
  .card-desc { font-size:10px; color:#4b5563; line-height:1.5; }
  .empty { color:#9ca3af; font-size:10px; text-align:center; padding:12px 0; }
  .footer { margin-top:10px; text-align:right; font-size:9px; color:#9ca3af; border-top:1px solid #e5e7eb; padding-top:6px; }
</style></head><body>
<div class="header">
  <img class="logo" src="https://www.ipade.mx/wp-content/uploads/2022/10/fav.png?w=512" alt="IPADE">
  <div class="header-text">
    <h1>Plan de Acción</h1>
    <p>IPADE Companion · Generado el ${reportDate}</p>
  </div>
</div>
<div class="board">${colHtml}</div>
<div class="footer">IPADE Business School · Herramienta de acompañamiento académico para participantes</div>
<script>window.onload=()=>{window.print();}</script>
</body></html>`;

  const win = window.open("", "_blank");
  if (win) { win.document.write(html); win.document.close(); }
}

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
  const [view, setView]               = useState<"list" | "kanban">("list");

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

  const reportDateStr = report
    ? new Date(report.created_at).toLocaleDateString("es-MX", { year: "numeric", month: "long", day: "numeric" })
    : "";

  return (
    <>
      <div className="page-head">
        <h1>Plan de Acción</h1>
        <p>
          El agente analiza tu Pasaporte y bitácoras para ordenar tus iniciativas en dos
          horizontes: lo que puedes mover ahora y lo que requiere planeación extensa.
        </p>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {!report && !generating && <EmptyState onGenerate={handleGenerate} />}
      {generating && <GeneratingState />}

      {report && !generating && (
        <>
          {/* Barra de controles */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 10 }}>
            <span className="muted" style={{ fontSize: 13 }}>
              Generado el {reportDateStr}
            </span>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <ViewToggle view={view} onChange={setView} />
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => printKanban(initiatives, reportDateStr)}
                title="Descargar PDF del tablero"
              >
                📄 PDF
              </button>
              <button className="btn btn-ghost btn-sm" onClick={handleGenerate}>
                ↺ Regenerar
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
function ViewToggle({ view, onChange }: { view: "list" | "kanban"; onChange: (v: "list" | "kanban") => void }) {
  const btn = (v: "list" | "kanban", icon: string, label: string) => (
    <button
      key={v}
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
      {btn("list",   "☰",  "Lista")}
      {btn("kanban", "⬛", "Tablero")}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Tablero Kanban — columnas con scroll independiente                  */
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

  function onDragStart(e: React.DragEvent, id: string) {
    dragging.current = id;
    e.dataTransfer.effectAllowed = "move";
  }
  function onDrop(e: React.DragEvent, status: InitiativeStatus) {
    e.preventDefault();
    if (dragging.current) { onStatusChange(dragging.current, status); dragging.current = null; }
    setDragOver(null);
  }
  function onDragOver(e: React.DragEvent, status: InitiativeStatus) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOver(status);
  }

  return (
    <div style={{
      display: "grid",
      /* Columnas de al menos 300 px; se apilan automáticamente en pantallas
         más angostas sin necesidad de scroll horizontal */
      gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))",
      gap: 16,
      alignItems: "start",
    }}>
      {COLUMNS.map((col) => {
        const cards = initiatives.filter((i) => i.status === col.status);
        const isOver = dragOver === col.status;
        return (
          <div
            key={col.status}
            onDragOver={(e) => onDragOver(e, col.status)}
            onDragLeave={() => setDragOver(null)}
            onDrop={(e) => onDrop(e, col.status)}
            style={{
              display: "flex",
              flexDirection: "column",
              border: `2px solid ${isOver ? col.color : "var(--line)"}`,
              borderRadius: 10,
              background: isOver ? col.bg : "#f8f9fb",
              transition: "border-color .15s, background .15s",
              overflow: "hidden",
            }}
          >
            {/* Cabecera fija */}
            <div style={{
              padding: "9px 12px",
              borderBottom: `2px solid ${col.color}`,
              display: "flex", alignItems: "center", gap: 7,
              background: "#fff", flexShrink: 0,
            }}>
              <span style={{ width: 9, height: 9, borderRadius: "50%", background: col.color, display: "inline-block" }} />
              <span style={{ fontWeight: 700, fontSize: 12, color: col.color }}>{col.label}</span>
              <span style={{
                marginLeft: "auto", background: col.color, color: "#fff",
                borderRadius: 10, fontSize: 10, padding: "1px 6px", fontWeight: 700,
              }}>{cards.length}</span>
            </div>

            {/* Cards — scroll interno con altura máxima cómoda */}
            <div style={{ maxHeight: 520, overflowY: "auto", padding: "8px", display: "flex", flexDirection: "column", gap: 7 }}>
              {cards.map((i) => (
                <KanbanCard key={i.id} initiative={i} onDragStart={onDragStart} onReminder={onReminder} />
              ))}
              {cards.length === 0 && (
                <p style={{ fontSize: 11, color: "var(--muted)", textAlign: "center", paddingTop: 24, margin: 0 }}>
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
/* Tarjeta del Kanban — compacta                                       */
/* ------------------------------------------------------------------ */
function KanbanCard({
  initiative, onDragStart, onReminder,
}: {
  initiative: Initiative;
  onDragStart: (e: React.DragEvent, id: string) => void;
  onReminder: (i: Initiative) => void;
}) {
  const b = CATEGORY_BADGE[initiative.category as keyof typeof CATEGORY_BADGE] ?? CATEGORY_BADGE.inmediata;
  return (
    <div
      draggable
      onDragStart={(e) => onDragStart(e, initiative.id)}
      style={{
        background: "#fff",
        border: "1px solid var(--line)",
        borderRadius: 7,
        padding: "9px 10px",
        cursor: "grab",
        boxShadow: "0 1px 3px rgba(0,0,0,.06)",
        userSelect: "none",
        flexShrink: 0,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 4, marginBottom: 5 }}>
        <span style={{
          fontSize: 10, fontWeight: 700, borderRadius: 4, padding: "2px 6px",
          background: b.bgColor, color: b.color, whiteSpace: "nowrap",
        }}>
          {b.icon} {b.label}
        </span>
        <span style={{ fontSize: 9, color: "var(--muted)", background: "#f3f4f6", borderRadius: 4, padding: "2px 5px" }}>
          {initiative.source === "bitacora" ? "Bitácora" : "Pasaporte"}
        </span>
      </div>
      <p style={{ margin: "0 0 4px", fontWeight: 600, fontSize: 12, lineHeight: 1.35, color: "var(--ink)" }}>
        {initiative.title}
      </p>
      <p style={{ margin: "0 0 8px", fontSize: 11, color: "var(--muted)", lineHeight: 1.45 }}>
        {initiative.description}
      </p>
      <button
        className="btn btn-ghost btn-sm"
        style={{ fontSize: 10, padding: "2px 7px" }}
        onClick={() => onReminder(initiative)}
      >
        ✉ Recordatorio
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Vista de lista                                                       */
/* ------------------------------------------------------------------ */
function ListView({
  initiatives, onStatusChange, onReminder,
}: {
  initiatives: Initiative[];
  onStatusChange: (id: string, status: InitiativeStatus) => void;
  onReminder: (i: Initiative) => void;
}) {
  const inmediatas = initiatives.filter((i) => i.category === "inmediata");
  const portafolio = initiatives.filter((i) => i.category === "portafolio");

  const section = (items: Initiative[], title: string, subtitle: string, accentColor: string, emptyMsg: string) => (
    <section>
      <div style={{
        display: "flex", alignItems: "center", gap: 12, marginBottom: 12,
        paddingBottom: 10, borderBottom: `2px solid ${accentColor}`,
      }}>
        <span style={{
          background: accentColor === "var(--ok)" ? "#dcfce7" : "#fef3c7",
          color: accentColor === "var(--ok)" ? "#16a34a" : "#92400e",
          borderRadius: 8, padding: "4px 12px", fontWeight: 700, fontSize: 13,
        }}>{title}</span>
        <span className="muted" style={{ fontSize: 13 }}>{subtitle}</span>
      </div>
      {items.length === 0
        ? <p className="muted">{emptyMsg}</p>
        : <div style={{ display: "grid", gap: 10 }}>
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
        "var(--ok)", "El agente no identificó iniciativas inmediatas.")}
      <div style={{ textAlign: "center", color: "var(--muted)", fontSize: 12, letterSpacing: "1px" }}>· · ·</div>
      {section(portafolio, "🏛 Portafolio de Iniciativas", "Meses de implementación · múltiples áreas o presupuesto",
        "var(--ipade-gold)", "No se identificaron iniciativas de portafolio.")}
    </div>
  );
}

const STATUS_LABELS: Record<string, string> = {
  pendiente: "Pendiente", en_progreso: "En progreso",
  completada: "Completada", diferida: "Diferida",
};

function ListCard({
  initiative, accentColor, onStatusChange, onReminder,
}: {
  initiative: Initiative;
  accentColor: string;
  onStatusChange: (id: string, s: InitiativeStatus) => void;
  onReminder: () => void;
}) {
  return (
    <div className="card" style={{ borderLeft: `4px solid ${accentColor}`, padding: "14px 16px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
        <h3 style={{ margin: 0, fontSize: 15, flex: 1 }}>{initiative.title}</h3>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span className="tag" style={{ fontSize: 11 }}>
            {initiative.source === "bitacora" ? "Bitácora" : "Pasaporte"}
          </span>
          <select
            value={initiative.status}
            onChange={(e) => onStatusChange(initiative.id, e.target.value as InitiativeStatus)}
            style={{ fontSize: 12, padding: "3px 8px", borderRadius: 6, border: "1px solid var(--line)", background: "#fff", color: "var(--ink)" }}
          >
            {Object.entries(STATUS_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
      </div>
      <p style={{ margin: "8px 0 10px", color: "var(--muted)", fontSize: 14, lineHeight: 1.6 }}>
        {initiative.description}
      </p>
      <button className="btn btn-ghost btn-sm" onClick={onReminder}>
        ✉ Programar recordatorio
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Estado vacío / generando                                             */
/* ------------------------------------------------------------------ */
function EmptyState({ onGenerate }: { onGenerate: () => void }) {
  return (
    <div className="card" style={{ textAlign: "center", padding: "48px 32px", borderTop: "4px solid var(--ipade-gold)" }}>
      <div style={{ fontSize: 40, marginBottom: 16 }}>📋</div>
      <h2 style={{ marginTop: 0 }}>Genera tu Plan de Acción</h2>
      <p style={{ color: "var(--muted)", maxWidth: 500, margin: "0 auto 24px" }}>
        El agente revisará tu Pasaporte y tus bitácoras para identificar y clasificar
        las iniciativas que has declarado querer llevar a cabo.
      </p>
      <p className="muted" style={{ fontSize: 13, marginBottom: 24 }}>
        Para mejores resultados, completa tu Pasaporte IPADE.{" "}
        <Link to="/pasaporte">Ir al Pasaporte →</Link>
      </p>
      <button className="btn btn-primary" style={{ padding: "12px 28px" }} onClick={onGenerate}>
        Generar mi Plan de Acción
      </button>
    </div>
  );
}

function GeneratingState() {
  return (
    <div className="card" style={{ textAlign: "center", padding: "48px 32px" }}>
      <div style={{ display: "flex", justifyContent: "center", marginBottom: 20 }}>
        <div className="spinner" style={{ width: 32, height: 32, border: "3px solid var(--line)", borderTopColor: "var(--ipade-navy)" }} />
      </div>
      <h2 style={{ marginTop: 0 }}>Analizando tus iniciativas…</h2>
      <p style={{ color: "var(--muted)", maxWidth: 400, margin: "0 auto" }}>
        El agente revisa tu Pasaporte y bitácoras. Esto puede tomar unos segundos.
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Modal de recordatorio — con selector de fecha                       */
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
  const [sendAt, setSendAt]   = useState(suggestedDate(initiative.category));
  const [sendNow, setSendNow] = useState(true);
  const [sending, setSending] = useState(false);
  const [sent, setSent]       = useState(false);
  const [error, setError]     = useState<string | null>(null);

  const isToday = sendAt === new Date().toISOString().slice(0, 10);

  async function handleSend() {
    if (!user) return;
    setSending(true);
    setError(null);
    try {
      const { data: reminder, error: insertErr } = await supabase
        .from("email_reminders")
        .insert({
          user_id: user.id,
          initiative_id: initiative.id,
          email_to: emailTo,
          subject,
          body,
          send_at: sendAt,
          status: "pendiente",
        })
        .select("id")
        .single();
      if (insertErr || !reminder) throw new Error(insertErr?.message ?? "Error al guardar.");

      if (sendNow) {
        await sendReminder(reminder.id);
      }
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
        <p className="muted" style={{ fontSize: 13, marginBottom: 16 }}>
          Iniciativa: <strong>{initiative.title}</strong>
        </p>

        {sent ? (
          <div>
            <div className="alert alert-ok">
              {sendNow
                ? <>✓ Correo enviado a <strong>{emailTo}</strong>.</>
                : <>✓ Recordatorio guardado para el <strong>{new Date(sendAt + "T12:00:00").toLocaleDateString("es-MX", { dateStyle: "long" })}</strong>.</>
              }
            </div>
            <button className="btn btn-ghost btn-sm" style={{ marginTop: 12 }} onClick={onClose}>Cerrar</button>
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

            {/* Fecha de recordatorio */}
            <div className="field">
              <label htmlFor="r-date" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span>Fecha de recordatorio</span>
                <span className="hint" style={{ fontWeight: 400 }}>
                  {initiative.category === "inmediata"
                    ? "⚡ Sugerida en 2 semanas (iniciativa inmediata)"
                    : "🏛 Sugerida en 90 días (iniciativa de portafolio)"}
                </span>
              </label>
              <input id="r-date" type="date" value={sendAt} min={new Date().toISOString().slice(0, 10)}
                onChange={(e) => { setSendAt(e.target.value); setSendNow(false); }} />
            </div>

            <div className="field" style={{ flexDirection: "row", alignItems: "center", gap: 10, display: "flex" }}>
              <input id="r-now" type="checkbox" checked={sendNow}
                onChange={(e) => setSendNow(e.target.checked)}
                style={{ width: 16, height: 16, accentColor: "var(--ipade-navy)", cursor: "pointer" }} />
              <label htmlFor="r-now" style={{ cursor: "pointer", margin: 0, fontWeight: 400, fontSize: 14 }}>
                {isToday ? "Enviar el correo ahora mismo" : "Enviar también el correo ahora (además de guardarlo)"}
              </label>
            </div>

            <div className="field">
              <label htmlFor="r-body">
                Mensaje <span className="hint">— generado por el agente, puedes editarlo</span>
              </label>
              <textarea id="r-body" style={{ minHeight: 140 }} value={body} onChange={(e) => setBody(e.target.value)} />
            </div>

            <div className="btn-row">
              <button className="btn btn-primary" onClick={handleSend} disabled={sending || !emailTo || !subject}>
                {sending ? "Guardando…" : sendNow ? "Enviar ahora" : "Guardar recordatorio"}
              </button>
              <button className="btn btn-ghost" onClick={onClose}>Cancelar</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
