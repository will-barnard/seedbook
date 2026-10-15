// Leads CRUD + follow-up generation + manual reminder.
import express from "express";
import { pool } from "../db.js";
import { generateFollowup, drydockConfigured } from "../drydock.js";
import { sendLeadReminder } from "../reminders.js";
import { resendConfigured } from "../resend.js";

export const leadsRouter = express.Router();

// Columns a client is allowed to set. Anything else in the body is ignored.
const WRITABLE = [
  "name",
  "company",
  "title",
  "email",
  "phone",
  "relationship",
  "business_needs",
  "next_steps",
  "status",
  "priority",
  "source",
  "estimated_value",
  "last_contact_date",
  "next_action_date",
  "notes",
];

function pickWritable(body) {
  const out = {};
  for (const k of WRITABLE) {
    if (k in body) {
      let v = body[k];
      if (v === "" || v === undefined) v = null;
      out[k] = v;
    }
  }
  return out;
}

async function getLead(id) {
  const { rows } = await pool.query("SELECT * FROM leads WHERE id = $1", [id]);
  return rows[0] || null;
}

// List, with optional ?status= and ?q= (name/company search).
leadsRouter.get("/", async (req, res) => {
  const { status, q } = req.query;
  const clauses = [];
  const params = [];
  if (status) {
    params.push(status);
    clauses.push(`status = $${params.length}`);
  }
  if (q) {
    params.push(`%${q}%`);
    clauses.push(`(name ILIKE $${params.length} OR company ILIKE $${params.length})`);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const { rows } = await pool.query(
    `SELECT * FROM leads ${where}
     ORDER BY
       CASE WHEN next_action_date IS NULL THEN 1 ELSE 0 END,
       next_action_date ASC,
       updated_at DESC`,
    params
  );
  res.json(rows);
});

leadsRouter.get("/:id", async (req, res) => {
  const lead = await getLead(req.params.id);
  if (!lead) return res.status(404).json({ error: "Lead not found." });
  const { rows: followups } = await pool.query(
    "SELECT * FROM followups WHERE lead_id = $1 ORDER BY created_at DESC",
    [req.params.id]
  );
  const { rows: proposals } = await pool.query(
    `SELECT id, status, line_items, sent_at, created_at, updated_at
       FROM proposals WHERE lead_id = $1 ORDER BY created_at DESC`,
    [req.params.id]
  );
  res.json({ ...lead, followups, proposals });
});

leadsRouter.post("/", async (req, res) => {
  const data = pickWritable(req.body || {});
  if (!data.name || !String(data.name).trim()) {
    return res.status(422).json({ error: "A name is required." });
  }
  const cols = Object.keys(data);
  const vals = Object.values(data);
  const placeholders = cols.map((_, i) => `$${i + 1}`);
  const { rows } = await pool.query(
    `INSERT INTO leads (${cols.join(", ")}) VALUES (${placeholders.join(", ")})
     RETURNING *`,
    vals
  );
  res.status(201).json(rows[0]);
});

leadsRouter.put("/:id", async (req, res) => {
  const existing = await getLead(req.params.id);
  if (!existing) return res.status(404).json({ error: "Lead not found." });
  const data = pickWritable(req.body || {});
  const cols = Object.keys(data);
  if (cols.length === 0) return res.json(existing);
  const sets = cols.map((c, i) => `${c} = $${i + 1}`);
  const vals = Object.values(data);
  vals.push(req.params.id);
  const { rows } = await pool.query(
    `UPDATE leads SET ${sets.join(", ")}, updated_at = now()
     WHERE id = $${vals.length} RETURNING *`,
    vals
  );
  res.json(rows[0]);
});

leadsRouter.delete("/:id", async (req, res) => {
  const { rowCount } = await pool.query("DELETE FROM leads WHERE id = $1", [
    req.params.id,
  ]);
  if (rowCount === 0) return res.status(404).json({ error: "Lead not found." });
  res.json({ ok: true });
});

// Generate a follow-up draft via dry-dock and store it in followups history.
leadsRouter.post("/:id/generate-followup", async (req, res) => {
  const lead = await getLead(req.params.id);
  if (!lead) return res.status(404).json({ error: "Lead not found." });
  if (!drydockConfigured()) {
    return res
      .status(503)
      .json({ error: "dry-dock is not configured on the server." });
  }
  try {
    const result = await generateFollowup(lead, req.body?.instructions);
    const { rows } = await pool.query(
      `INSERT INTO followups (lead_id, content, model, worker)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [lead.id, result.content, result.model || null, result.worker || null]
    );
    res.json({ followup: rows[0], meta: result });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// Send a manual reminder email for this lead.
leadsRouter.post("/:id/remind", async (req, res) => {
  const lead = await getLead(req.params.id);
  if (!lead) return res.status(404).json({ error: "Lead not found." });
  if (!resendConfigured()) {
    return res
      .status(503)
      .json({ error: "Resend is not configured on the server." });
  }
  try {
    await sendLeadReminder(lead);
    res.json({ ok: true });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});
