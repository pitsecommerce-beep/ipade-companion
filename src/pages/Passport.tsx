import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { supabase } from "../lib/supabase";
import type { Passport } from "../lib/types";

type Form = Omit<Passport, "id" | "user_id" | "created_at" | "updated_at" | "answers">;

const EMPTY: Form = {
  full_name: "",
  role: "",
  seniority: "",
  personal_context: "",
  company_name: "",
  industry: "",
  company_size: "",
  company_role: "",
  industry_context: "",
  company_context: "",
  objectives: "",
};

const EMPTY_ANSWERS: Record<string, string> = {
  dev_priorities: "",
  strategic_initiative: "",
  obstacles: "",
  additional_context: "",
};

interface Question {
  key: keyof Form;
  label: string;
  hint?: string;
  long?: boolean;
}

interface AnswerQuestion {
  key: string;
  label: string;
  hint?: string;
  long?: boolean;
}

const PERSON: Question[] = [
  { key: "full_name", label: "Nombre completo" },
  { key: "role", label: "Puesto / cargo actual", hint: "Ej. Directora General, VP de Operaciones" },
  {
    key: "seniority",
    label: "Trayectoria",
    hint: "Años de experiencia y nivel de responsabilidad",
  },
  {
    key: "personal_context",
    label: "¿Qué te trae al IPADE y qué esperas de ti en el programa?",
    hint: "Motivaciones, retos personales de liderazgo, objetivos de desarrollo",
    long: true,
  },
];

const COMPANY: Question[] = [
  { key: "company_name", label: "Nombre de la empresa" },
  { key: "industry", label: "Industria / sector" },
  {
    key: "company_size",
    label: "Tamaño de la empresa",
    hint: "Número de colaboradores y/o facturación aproximada",
  },
  {
    key: "company_role",
    label: "Posición de la empresa en su industria",
    hint: "Ej. líder regional, retador, nicho especializado",
  },
  {
    key: "industry_context",
    label: "Contexto de la industria",
    hint: "Dinámica competitiva, tendencias, regulación, disrupciones relevantes",
    long: true,
  },
  {
    key: "company_context",
    label: "Situación actual de la empresa",
    hint: "Retos, prioridades estratégicas, fortalezas y dolores actuales",
    long: true,
  },
  {
    key: "objectives",
    label: "Iniciativas u objetivos que tienes en mente",
    hint: "Proyectos o decisiones donde quieras apoyo del agente más adelante",
    long: true,
  },
];

const DEVELOPMENT: AnswerQuestion[] = [
  {
    key: "dev_priorities",
    label: "¿Cuál sería tu prioridad de desarrollo en términos de tus habilidades y conocimientos?",
    hint: "Considera tanto competencias técnicas como habilidades directivas y de liderazgo",
    long: true,
  },
  {
    key: "strategic_initiative",
    label: "Iniciativa estratégica prioritaria en tu rol directivo",
    hint: "¿Existe algún proyecto o transformación que sea urgente o de alto impacto?",
    long: true,
  },
  {
    key: "obstacles",
    label: "Mayores obstáculos que enfrentas hoy",
    hint: "Barreras internas, externas o personales que limitan tu avance",
    long: true,
  },
  {
    key: "additional_context",
    label: "¿Algo más que debería saber tu IPADE Companion?",
    hint: "Retos adicionales, contexto relevante o áreas donde el agente puede ayudarte mejor",
    long: true,
  },
];

export default function PassportPage() {
  const { user } = useAuth();
  const [form, setForm] = useState<Form>(EMPTY);
  const [answers, setAnswers] = useState<Record<string, string>>(EMPTY_ANSWERS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [privacyAccepted, setPrivacyAccepted] = useState(false);

  useEffect(() => {
    if (!user) return;
    supabase
      .from("passports")
      .select("*")
      .eq("user_id", user.id)
      .maybeSingle()
      .then(({ data, error }) => {
        if (error) setError(error.message);
        if (data) {
          const { id, user_id, created_at, updated_at, answers: savedAnswers, ...rest } = data as Passport;
          void id;
          void user_id;
          void created_at;
          void updated_at;
          setForm({ ...EMPTY, ...rest });
          if (savedAnswers) {
            setAnswers({ ...EMPTY_ANSWERS, ...savedAnswers });
          }
          setPrivacyAccepted(true);
        }
        setLoading(false);
      });
  }, [user]);

  function update(key: keyof Form, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
    setSavedAt(null);
  }

  function updateAnswer(key: string, value: string) {
    setAnswers((a) => ({ ...a, [key]: value }));
    setSavedAt(null);
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!user) return;
    setSaving(true);
    setError(null);
    const { error } = await supabase
      .from("passports")
      .upsert({ ...form, answers, user_id: user.id }, { onConflict: "user_id" });
    setSaving(false);
    if (error) {
      setError(error.message);
    } else {
      setSavedAt(new Date().toLocaleTimeString("es-MX"));
    }
  }

  if (loading) return <div className="card">Cargando tu Pasaporte…</div>;

  return (
    <>
      <div className="page-head">
        <h1>Pasaporte IPADE</h1>
        <p>
          Tu perfil personal y el contexto de tu empresa e industria. El agente usa
          esta información para darte respuestas y acompañamiento a tu medida.
        </p>
        <Link to="/pasaporte/voz" className="btn btn-primary" style={{ marginTop: 8, display: "inline-block" }}>
          Llenar por voz
        </Link>
      </div>

      {/* Aviso de privacidad */}
      {!privacyAccepted ? (
        <div className="card" style={{ borderLeft: "4px solid var(--ipade-gold)", marginBottom: 24 }}>
          <h2 style={{ marginTop: 0, fontSize: 18 }}>Aviso de privacidad y confidencialidad</h2>
          <p style={{ marginBottom: 12 }}>
            La información que compartas en este Pasaporte es estrictamente confidencial y
            será utilizada <strong>únicamente</strong> para personalizar tu experiencia de
            acompañamiento dentro del programa IPADE.
          </p>
          <ul style={{ paddingLeft: 20, marginBottom: 12, lineHeight: 1.8 }}>
            <li>Tus datos <strong>no serán compartidos</strong> con terceros ni utilizados con fines comerciales.</li>
            <li>La información permanece asociada a tu cuenta personal y no es visible para otros participantes.</li>
            <li>Su único propósito es enriquecer el contexto del agente de IA para que las respuestas sean más relevantes a tu situación.</li>
            <li>Puedes actualizar o eliminar tu información en cualquier momento.</li>
          </ul>
          <p style={{ margin: "0 0 16px", color: "var(--muted)", fontSize: 13 }}>
            Al continuar, aceptas que la información ingresada se usará exclusivamente para el desarrollo de tus sesiones en IPADE Companion.
          </p>
          <button className="btn btn-primary" onClick={() => setPrivacyAccepted(true)}>
            Entendido, continuar con mi Pasaporte
          </button>
        </div>
      ) : (
        <div className="alert alert-info" style={{ borderLeft: "3px solid var(--ipade-gold)", marginBottom: 20 }}>
          <strong>Privacidad:</strong> Tu información es confidencial y se usa exclusivamente para personalizar tus sesiones. No se comparte con terceros ni se usa con fines comerciales.
        </div>
      )}

      {error && <div className="alert alert-error">{error}</div>}
      {savedAt && <div className="alert alert-ok">Pasaporte guardado a las {savedAt}.</div>}

      {privacyAccepted && (
        <form onSubmit={onSubmit}>
          <div className="card">
            <h2 style={{ marginTop: 0 }}>Sobre ti</h2>
            {PERSON.map((q) => (
              <Field key={q.key} q={q} value={form[q.key]} onChange={update} />
            ))}
          </div>

          <div className="card">
            <h2 style={{ marginTop: 0 }}>Sobre tu empresa e industria</h2>
            {COMPANY.map((q) => (
              <Field key={q.key} q={q} value={form[q.key]} onChange={update} />
            ))}
          </div>

          <div className="card">
            <h2 style={{ marginTop: 0 }}>Desarrollo directivo y prioridades</h2>
            <p style={{ color: "var(--muted)", marginTop: 0, marginBottom: 20, fontSize: 14 }}>
              Esta sección ayuda al agente a entender tus prioridades de crecimiento y los retos
              más importantes que enfrentas como directivo.
            </p>
            {DEVELOPMENT.map((q) => (
              <AnswerField key={q.key} q={q} value={answers[q.key] ?? ""} onChange={updateAnswer} />
            ))}
          </div>

          <div className="btn-row" style={{ marginTop: 16 }}>
            <button className="btn btn-primary" disabled={saving}>
              {saving ? "Guardando…" : "Guardar Pasaporte"}
            </button>
          </div>
        </form>
      )}
    </>
  );
}

function Field({
  q,
  value,
  onChange,
}: {
  q: Question;
  value: string;
  onChange: (k: keyof Form, v: string) => void;
}) {
  return (
    <div className="field">
      <label htmlFor={q.key}>
        {q.label} {q.hint && <span className="hint">— {q.hint}</span>}
      </label>
      {q.long ? (
        <textarea id={q.key} value={value} onChange={(e) => onChange(q.key, e.target.value)} />
      ) : (
        <input id={q.key} value={value} onChange={(e) => onChange(q.key, e.target.value)} />
      )}
    </div>
  );
}

function AnswerField({
  q,
  value,
  onChange,
}: {
  q: AnswerQuestion;
  value: string;
  onChange: (k: string, v: string) => void;
}) {
  return (
    <div className="field">
      <label htmlFor={q.key}>
        {q.label} {q.hint && <span className="hint">— {q.hint}</span>}
      </label>
      {q.long ? (
        <textarea id={q.key} value={value} onChange={(e) => onChange(q.key, e.target.value)} />
      ) : (
        <input id={q.key} value={value} onChange={(e) => onChange(q.key, e.target.value)} />
      )}
    </div>
  );
}
