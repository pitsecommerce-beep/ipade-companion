import { useEffect, useState, type FormEvent } from "react";
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

interface Question {
  key: keyof Form;
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

export default function PassportPage() {
  const { user } = useAuth();
  const [form, setForm] = useState<Form>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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
          const { id, user_id, created_at, updated_at, answers, ...rest } = data as Passport;
          void id;
          void user_id;
          void created_at;
          void updated_at;
          void answers;
          setForm({ ...EMPTY, ...rest });
        }
        setLoading(false);
      });
  }, [user]);

  function update(key: keyof Form, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
    setSavedAt(null);
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!user) return;
    setSaving(true);
    setError(null);
    const { error } = await supabase
      .from("passports")
      .upsert({ ...form, user_id: user.id }, { onConflict: "user_id" });
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
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {savedAt && <div className="alert alert-ok">Pasaporte guardado a las {savedAt}.</div>}

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

        <div className="btn-row" style={{ marginTop: 16 }}>
          <button className="btn btn-primary" disabled={saving}>
            {saving ? "Guardando…" : "Guardar Pasaporte"}
          </button>
        </div>
      </form>
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
