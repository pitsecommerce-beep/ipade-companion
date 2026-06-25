import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import agentRouter from "./routes/agent.js";
import generateReportRouter from "./routes/generate-report.js";
import sendReminderRouter from "./routes/send-reminder.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 3001);
// En producción el build de Vite está en dist/ (junto al servidor)
const DIST = path.resolve(__dirname, "../dist");

// Validar variables de entorno al arrancar y avisar en consola.
const REQUIRED_VARS = ["VITE_SUPABASE_URL", "VITE_SUPABASE_ANON_KEY", "ANTHROPIC_API_KEY"];
const OPTIONAL_VARS: { name: string; feature: string }[] = [
  { name: "RESEND_API_KEY",    feature: "envío de correos recordatorio" },
  { name: "RESEND_FROM_EMAIL", feature: "dirección de origen de correos" },
];

const missingRequired = REQUIRED_VARS.filter((v) => !process.env[v]);
if (missingRequired.length > 0) {
  console.error("❌  Variables de entorno REQUERIDAS no configuradas:");
  missingRequired.forEach((v) => console.error(`     • ${v}`));
  console.error("   El servidor no puede iniciar correctamente sin ellas.\n");
}

const missingOptional = OPTIONAL_VARS.filter(({ name }) => !process.env[name]);
if (missingOptional.length > 0) {
  console.warn("⚠️   Variables de entorno OPCIONALES no configuradas:");
  missingOptional.forEach(({ name, feature }) =>
    console.warn(`     • ${name}  →  necesaria para: ${feature}`)
  );
  console.warn("   El servidor inicia normalmente; las funciones que dependen");
  console.warn("   de estas variables devolverán un error 503 al ser invocadas.\n");
}

const app = express();
app.use(express.json({ limit: "2mb" }));

/* -------- API -------- */
app.use("/api/agent", agentRouter);
app.use("/api/generate-report", generateReportRouter);
app.use("/api/send-reminder", sendReminderRouter);

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, ts: new Date().toISOString() });
});

/* -------- React SPA -------- */
app.use(express.static(DIST));
// Todas las rutas no-API sirven el index.html para que el router de React funcione
app.get(/^(?!\/api).*/, (_req, res) => {
  res.sendFile(path.join(DIST, "index.html"));
});

app.listen(PORT, () => {
  console.log(`IPADE Companion escuchando en http://localhost:${PORT}`);
});
