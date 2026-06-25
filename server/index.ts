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
