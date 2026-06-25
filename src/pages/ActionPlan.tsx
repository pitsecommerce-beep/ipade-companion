import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { supabase } from "../lib/supabase";
import { generateReport, sendReminder } from "../lib/agent";
import type { Initiative, InitiativeReport, InitiativeStatus } from "../lib/types";

/* ------------------------------------------------------------------ */
/* Página principal                                                     */
/* ------------------------------------------------------------------ */
export default function ActionPlan() {
  const { user } = useAuth();
  const [report, setReport] = useState<InitiativeReport | null>(null);
  const [initiatives, setInitiatives] = useState<Initiative[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reminderTarget, setReminderTarget] = useState<Initiative | null>(null);

  const load = useCallback(async () => {
    if (!user) return;
    // Cargar el reporte más reciente + sus iniciativas
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

  const inmediatas = initiatives.filter((i) => i.category === "inmediata");
  const portafolio = initiatives.filter((i) => i.category === "portafolio");

  if (loading) {
    return <div className="card">Cargando tu Plan de Acción…</div>;
  }

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

      {!report && !generating && (
        <EmptyState onGenerate={handleGenerate} />
      )}

      {generating && <GeneratingState />}

      {report && !generating && (
        <>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
            <span className="muted" style={{ fontSize: 13 }}>
              Generado el {new Date(report.created_at).toLocaleDateString("es-MX", {
                year: "numeric", month: "long", day: "numeric",
              })}
            </span>
            <button className="btn btn-ghost btn-sm" onClick={handleGenerate}>
              Regenerar reporte
            </button>
          </div>

          {initiatives.length === 0 ? (
            <div className="card muted">
              No se encontraron iniciativas declaradas. Asegúrate de completar tu
              Pasaporte y agregar quick wins en tus bitácoras.
            </div>
          ) : (
            <div style={{ display: "grid", gap: 28 }}>
              {/* Sección 1: Iniciativas Inmediatas */}
              <section>
                <div style={{
                  display: "flex", alignItems: "center", gap: 12, marginBottom: 12,
                  paddingBottom: 10, borderBottom: "2px solid var(--ok)",
                }}>
                  <span style={{
                    background: "#e7f5ee", color: "var(--ok)",
                    borderRadius: 8, padding: "4px 12px", fontWeight: 700, fontSize: 13,
                  }}>
                    ⚡ Iniciativas Inmediatas
                  </span>
                  <span className="muted" style={{ fontSize: 13 }}>
                    Implementables en semanas · pocos recursos
                  </span>
                </div>

                {inmediatas.length === 0 ? (
                  <p className="muted">El agente no identificó iniciativas inmediatas en esta iteración.</p>
                ) : (
                  <div style={{ display: "grid", gap: 12 }}>
                    {inmediatas.map((i) => (
                      <InitiativeCard
                        key={i.id}
                        initiative={i}
                        accentColor="var(--ok)"
                        onStatusChange={updateStatus}
                        onReminder={() => setReminderTarget(i)}
                      />
                    ))}
                  </div>
                )}
              </section>

              {/* Separador visual intencional */}
              <div style={{
                textAlign: "center", padding: "8px 0", color: "var(--muted)",
                fontSize: 12, letterSpacing: "1px", textTransform: "uppercase",
              }}>
                · · ·
              </div>

              {/* Sección 2: Portafolio de Iniciativas */}
              <section>
                <div style={{
                  display: "flex", alignItems: "center", gap: 12, marginBottom: 12,
                  paddingBottom: 10, borderBottom: "2px solid var(--ipade-gold)",
                }}>
                  <span style={{
                    background: "rgba(200,165,91,0.15)", color: "var(--ipade-gold-dark)",
                    borderRadius: 8, padding: "4px 12px", fontWeight: 700, fontSize: 13,
                  }}>
                    🏛 Portafolio de Iniciativas
                  </span>
                  <span className="muted" style={{ fontSize: 13 }}>
                    Meses de implementación · múltiples áreas o presupuesto
                  </span>
                </div>

                {portafolio.length === 0 ? (
                  <p className="muted">No se identificaron iniciativas de portafolio en esta iteración.</p>
                ) : (
                  <div style={{ display: "grid", gap: 12 }}>
                    {portafolio.map((i) => (
                      <InitiativeCard
                        key={i.id}
                        initiative={i}
                        accentColor="var(--ipade-gold)"
                        onStatusChange={updateStatus}
                        onReminder={() => setReminderTarget(i)}
                      />
                    ))}
                  </div>
                )}
              </section>
            </div>
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
/* Estado vacío                                                         */
/* ------------------------------------------------------------------ */
function EmptyState({ onGenerate }: { onGenerate: () => void }) {
  return (
    <div className="card" style={{
      textAlign: "center", padding: "48px 32px",
      borderTop: "4px solid var(--ipade-gold)",
    }}>
      <div style={{ fontSize: 40, marginBottom: 16 }}>📋</div>
      <h2 style={{ marginTop: 0 }}>Genera tu Plan de Acción</h2>
      <p style={{ color: "var(--muted)", maxWidth: 500, margin: "0 auto 24px" }}>
        El agente revisará tu Pasaporte y todas tus bitácoras para identificar,
        ordenar y clasificar las iniciativas que has declarado querer llevar a cabo.
        El resultado te dará claridad sobre qué mover primero y qué planear con más calma.
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
        <div className="spinner" style={{
          width: 32, height: 32, border: "3px solid var(--line)",
          borderTopColor: "var(--ipade-navy)",
        }} />
      </div>
      <h2 style={{ marginTop: 0 }}>Analizando tus iniciativas…</h2>
      <p style={{ color: "var(--muted)", maxWidth: 400, margin: "0 auto" }}>
        El agente está revisando tu Pasaporte y tus bitácoras para ordenar tus iniciativas.
        Esto puede tomar unos segundos.
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Tarjeta de iniciativa                                                */
/* ------------------------------------------------------------------ */
const STATUS_LABELS: Record<string, string> = {
  pendiente: "Pendiente",
  en_progreso: "En progreso",
  completada: "Completada",
  diferida: "Diferida",
};

function InitiativeCard({
  initiative,
  accentColor,
  onStatusChange,
  onReminder,
}: {
  initiative: Initiative;
  accentColor: string;
  onStatusChange: (id: string, status: InitiativeStatus) => void;
  onReminder: () => void;
}) {
  return (
    <div className="card" style={{
      borderLeft: `4px solid ${accentColor}`,
      padding: "16px 18px",
    }}>
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
              border: "1px solid var(--line)", background: "#fff",
              color: "var(--ink)", width: "auto",
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
/* Modal de recordatorio                                                */
/* ------------------------------------------------------------------ */
function ReminderModal({
  initiative,
  userEmail,
  onClose,
}: {
  initiative: Initiative;
  userEmail: string;
  onClose: () => void;
}) {
  const { user } = useAuth();
  const [emailTo, setEmailTo] = useState(userEmail);
  const [subject, setSubject] = useState(initiative.email_subject || `Recordatorio: ${initiative.title}`);
  const [body, setBody] = useState(initiative.email_body || "");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSend() {
    if (!user) return;
    setSending(true);
    setError(null);
    try {
      // Guardar el recordatorio y enviarlo de inmediato
      const { data: reminder, error: insertErr } = await supabase
        .from("email_reminders")
        .insert({
          user_id: user.id,
          initiative_id: initiative.id,
          email_to: emailTo,
          subject,
          body,
          status: "pendiente",
        })
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
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)",
      display: "grid", placeItems: "center", zIndex: 100, padding: 20,
    }}>
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
            <div className="alert alert-ok">
              ✓ Correo enviado correctamente a <strong>{emailTo}</strong>.
            </div>
            <button className="btn btn-ghost btn-sm" onClick={onClose}>Cerrar</button>
          </div>
        ) : (
          <>
            {error && <div className="alert alert-error">{error}</div>}

            <div className="field">
              <label htmlFor="r-to">Enviar a</label>
              <input
                id="r-to"
                type="email"
                value={emailTo}
                onChange={(e) => setEmailTo(e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="r-subject">Asunto</label>
              <input
                id="r-subject"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="r-body">
                Mensaje <span className="hint">— generado por el agente, puedes editarlo</span>
              </label>
              <textarea
                id="r-body"
                style={{ minHeight: 160 }}
                value={body}
                onChange={(e) => setBody(e.target.value)}
              />
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
