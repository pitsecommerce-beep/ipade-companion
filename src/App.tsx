import { NavLink, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useState } from "react";
import { useAuth } from "./context/AuthContext";
import { isSupabaseConfigured } from "./lib/supabase";
import Login from "./pages/Login";
import Passport from "./pages/Passport";
import Dashboard from "./pages/Dashboard";
import SessionDetail from "./pages/SessionDetail";
import ActionPlan from "./pages/ActionPlan";
import PassportVoice from "./pages/PassportVoice";
import type { ReactNode } from "react";

function Brand() {
  return (
    <NavLink to="/" className="brand">
      <span className="brand-mark">
        <img src="https://www.ipade.mx/wp-content/uploads/2022/10/fav.png?w=512" alt="IPADE" />
      </span>
      <span className="brand-text">
        <strong>IPADE Companion</strong>
        <span>Acompañamiento académico</span>
      </span>
    </NavLink>
  );
}

function Layout({ children }: { children: ReactNode }) {
  const { user, signOut } = useAuth();
  const [confirmLogout, setConfirmLogout] = useState(false);

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar-inner">
          <Brand />
          {user && (
            <nav className="nav">
              <NavLink to="/" end>Jornadas</NavLink>
              <NavLink to="/pasaporte">Pasaporte</NavLink>
              <NavLink to="/plan">Plan de Acción</NavLink>
              <button
                className="btn btn-sm"
                style={{ background: "#c0392b", color: "#fff", border: "none" }}
                onClick={() => setConfirmLogout(true)}
              >
                Salir
              </button>
            </nav>
          )}
        </div>
      </header>
      <main className="content">{children}</main>
      <footer className="footer">
        IPADE Companion · Herramienta de apoyo para participantes del IPADE Business School.
      </footer>

      {confirmLogout && (
        <div style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)",
          display: "grid", placeItems: "center", zIndex: 200, padding: 20,
        }}>
          <div className="card" style={{ maxWidth: 360, width: "100%", textAlign: "center", padding: "32px 28px" }}>
            <div style={{ fontSize: 18, marginBottom: 12, fontWeight: 600, color: "var(--ipade-navy)" }}>Hasta pronto</div>
            <h2 style={{ margin: "0 0 8px" }}>¿Cerrar sesión?</h2>
            <p style={{ color: "var(--muted)", margin: "0 0 24px", fontSize: 14 }}>
              Tu información está guardada. Podrás volver a acceder en cualquier momento.
            </p>
            <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
              <button
                className="btn btn-sm"
                style={{ background: "#c0392b", color: "#fff", border: "none", padding: "8px 20px" }}
                onClick={() => { signOut(); setConfirmLogout(false); }}
              >
                Cerrar sesión
              </button>
              <button className="btn btn-ghost" onClick={() => setConfirmLogout(false)}>
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ConfigGuard({ children }: { children: ReactNode }) {
  if (isSupabaseConfigured) return <>{children}</>;
  return (
    <Layout>
      <div className="card">
        <h1>Configuración pendiente</h1>
        <p className="muted">
          La plataforma aún no tiene conectado su backend de Supabase. Define las
          variables de entorno <code>VITE_SUPABASE_URL</code> y{" "}
          <code>VITE_SUPABASE_ANON_KEY</code> (en <code>.env.local</code> para
          desarrollo, o como <em>variables</em> del repositorio para el despliegue
          en GitHub Pages) y vuelve a publicar.
        </p>
        <p className="muted">
          Consulta <code>README.md</code> y <code>docs/CONTEXT.md</code> para los
          pasos completos de configuración.
        </p>
      </div>
    </Layout>
  );
}

function Protected({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) {
    return (
      <Layout>
        <div className="card">Cargando…</div>
      </Layout>
    );
  }
  if (!user) return <Navigate to="/login" state={{ from: location }} replace />;
  return <Layout>{children}</Layout>;
}

export default function App() {
  return (
    <ConfigGuard>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route
          path="/"
          element={
            <Protected>
              <Dashboard />
            </Protected>
          }
        />
        <Route
          path="/pasaporte"
          element={
            <Protected>
              <Passport />
            </Protected>
          }
        />
        <Route
          path="/pasaporte/voz"
          element={
            <Protected>
              <PassportVoice />
            </Protected>
          }
        />
        <Route
          path="/plan"
          element={
            <Protected>
              <ActionPlan />
            </Protected>
          }
        />
        <Route
          path="/sesion/:id"
          element={
            <Protected>
              <SessionDetail />
            </Protected>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </ConfigGuard>
  );
}
