// Seedbook backend entrypoint.
import "dotenv/config";
import express from "express";
import cookieParser from "cookie-parser";

import { migrate } from "./db.js";
import { registerAuthRoutes, requireAuth } from "./auth.js";
import { leadsRouter } from "./routes/leads.js";
import { offeringsRouter } from "./routes/offerings.js";
import { settingsRouter } from "./routes/settings.js";
import { proposalsRouter } from "./routes/proposals.js";
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
app.use("/api/offerings", requireAuth, offeringsRouter);
app.use("/api/settings", requireAuth, settingsRouter);
app.use("/api/proposals", requireAuth, proposalsRouter);

// Manual trigger for the daily digest (handy for testing the email path).
app.post("/api/reminders/run", requireAuth, async (req, res) => {
  try {
    const result = await sendDailyDigest();
    res.json(result);
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// Error middleware — must be registered after every route. Handlers wrapped
// in `ah()` land here with an err.status; bad UUIDs in a path (pg 22P02)
// read as not-found rather than a 500.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err?.code === "22P02") return res.status(404).json({ error: "Not found." });
  const status = err.status && err.status >= 400 && err.status < 600 ? err.status : 500;
  if (status >= 500) console.error(`[seedbook] ${req.method} ${req.path}:`, err);
  res.status(status).json({ error: err.message || "Server error." });
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
