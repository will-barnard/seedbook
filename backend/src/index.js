// Seedbook backend entrypoint.
import "dotenv/config";
import express from "express";
import cookieParser from "cookie-parser";

import { migrate } from "./db.js";
import { registerAuthRoutes, requireAuth } from "./auth.js";
import { leadsRouter } from "./routes/leads.js";
import { scheduleReminders, sendDailyDigest } from "./reminders.js";
import { drydockConfigured } from "./drydock.js";
import { resendConfigured } from "./resend.js";

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(cookieParser());

// Liveness (used by Docker healthcheck) — no auth, no DB.
app.get("/healthz", (req, res) => res.json({ status: "ok" }));

// Runtime capability flags so the UI can hide buttons that would 503.
app.get("/api/config", (req, res) => {
  res.json({
    drydock: drydockConfigured(),
    resend: resendConfigured(),
  });
});

// Auth (public): setup / login / logout / status.
registerAuthRoutes(app);

// Everything below requires a session.
app.use("/api/leads", requireAuth, leadsRouter);

// Manual trigger for the daily digest (handy for testing the email path).
app.post("/api/reminders/run", requireAuth, async (req, res) => {
  try {
    const result = await sendDailyDigest();
    res.json(result);
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

const PORT = process.env.PORT || 3001;

async function start() {
  await migrate();
  scheduleReminders();
  app.listen(PORT, () => {
    console.log(`[seedbook] backend listening on :${PORT}`);
    console.log(
      `[seedbook] dry-dock ${drydockConfigured() ? "configured" : "NOT configured"}, ` +
        `Resend ${resendConfigured() ? "configured" : "NOT configured"}`
    );
  });
}

start().catch((e) => {
  console.error("[seedbook] failed to start:", e);
  process.exit(1);
});
