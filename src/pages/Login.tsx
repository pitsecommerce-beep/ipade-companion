import { useState, type FormEvent } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export default function Login() {
  const { user, signIn, signUp } = useAuth();
  const [mode, setMode] = useState<"in" | "up">("in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  if (user) return <Navigate to="/" replace />;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      if (mode === "in") {
        await signIn(email, password);
      } else {
        const { needsConfirmation } = await signUp(email, password);
        if (needsConfirmation) {
          setInfo(
            "Cuenta creada. Revisa tu correo para confirmar el acceso y luego inicia sesión.",
          );
          setMode("in");
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ocurrió un error.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="app-shell">
      <div className="center-screen">
        <div className="card auth-card">
          <div style={{ textAlign: "center", marginBottom: 16 }}>
            <span className="brand-mark" style={{ display: "inline-grid", width: 56, height: 56 }}>
              <img src="https://www.ipade.mx/wp-content/uploads/2022/10/fav.png?w=512" alt="IPADE" />
            </span>
            <h1 style={{ marginTop: 12, marginBottom: 2 }}>IPADE Companion</h1>
            <p className="muted" style={{ margin: 0 }}>
              {mode === "in"
                ? "Ingresa para continuar con tu Pasaporte y bitácoras"
                : "Crea tu cuenta de participante"}
            </p>
          </div>

          {error && <div className="alert alert-error">{error}</div>}
          {info && <div className="alert alert-ok">{info}</div>}

          <form onSubmit={onSubmit}>
            <div className="field">
              <label htmlFor="email">Correo electrónico</label>
              <input
                id="email"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="password">Contraseña</label>
              <input
                id="password"
                type="password"
                required
                minLength={6}
                autoComplete={mode === "in" ? "current-password" : "new-password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <button className="btn btn-primary" style={{ width: "100%" }} disabled={busy}>
              {busy ? "Procesando…" : mode === "in" ? "Iniciar sesión" : "Crear cuenta"}
            </button>
          </form>

          <p className="muted" style={{ textAlign: "center", marginTop: 16, marginBottom: 0 }}>
            {mode === "in" ? "¿No tienes cuenta? " : "¿Ya tienes cuenta? "}
            <button
              className="btn btn-ghost btn-sm"
              type="button"
              onClick={() => {
                setMode(mode === "in" ? "up" : "in");
                setError(null);
                setInfo(null);
              }}
            >
              {mode === "in" ? "Regístrate" : "Inicia sesión"}
            </button>
          </p>
        </div>
      </div>
      <footer className="footer">
        IPADE Companion · Herramienta de apoyo para participantes del IPADE Business School.
      </footer>
    </div>
  );
}
