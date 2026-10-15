// Proposals: setup, AI drafts and revisions, hand edits, send log, outcome.
//
// Flow: create from a lead → pick offerings / tone / directions → generate
// (v1) → revise with feedback or edit by hand (v2, v3…) → copy into an email
// → "mark sent" snapshots exactly what went out → "won" / "lost" closes it.
// Lead status follows along (proposal on send, won/lost on outcome).
import express from "express";
import { pool } from "../db.js";
import { drydockConfigured } from "../drydock.js";
import { getSettings } from "../services/settings.js";
import { fixedParts, assembleEmail, cleanLineItems } from "../services/proposalText.js";
import { writeDraft, reviseDraft, pick, SECTIONS, TONES } from "../services/proposalWriter.js";
import { ah, httpError } from "./asyncHandler.js";

export const proposalsRouter = express.Router();

const LEAD_FIELDS = "id, name, company, title, email, relationship, business_needs, notes, status";

async function getProposal(id) {
  const { rows } = await pool.query("SELECT * FROM proposals WHERE id = $1", [id]);
  if (!rows[0]) throw httpError(404, "Proposal not found.");
  return rows[0];
}

async function getLead(id) {
  const { rows } = await pool.query(`SELECT ${LEAD_FIELDS} FROM leads WHERE id = $1`, [id]);
  if (!rows[0]) throw httpError(404, "Lead not found.");
  return rows[0];
}

// Everything the editor needs in one response. Pricing, next steps etc. are
// rendered here so the browser never does price math; it only drops the
// draft's prose into proposal.layout for the live preview.
async function view(id) {
  const p = await getProposal(id);
  const lead = await getLead(p.lead_id);
  const { rows: versions } = await pool.query(
    "SELECT * FROM proposal_versions WHERE proposal_id = $1 ORDER BY version DESC",
    [id]
  );
  return {
    proposal: p,
    lead,
    versions,
    rendered: fixedParts(p, lead),
    tones: Object.keys(TONES),
  };
}

async function insertVersion(proposalId, sections, { source, feedback = null, meta = {} }) {
  const s = pick(sections);
  // Version number computed in the same statement; the UNIQUE constraint
  // turns a (single-user, unlikely) race into an error rather than a dupe.
  const { rows } = await pool.query(
    `INSERT INTO proposal_versions
       (proposal_id, version, subject, intro, scope, questions, closing, source, feedback, worker, pool, elapsed_ms)
     SELECT $1, COALESCE(MAX(version), 0) + 1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11
       FROM proposal_versions WHERE proposal_id = $1
     RETURNING *`,
    [proposalId, s.subject, s.intro, s.scope, s.questions, s.closing, source, feedback,
     meta.worker ?? null, meta.pool ?? null, meta.elapsed_ms ?? null]
  );
  await pool.query("UPDATE proposals SET updated_at = now() WHERE id = $1", [proposalId]);
  return rows[0];
}

// dry-dock failures, translated into something actionable in the UI.
function drydockError(e) {
  switch (e.status) {
    case 401:
      return httpError(502, "dry-dock rejected the API key — check DRYDOCK_API_KEY on both sides.");
    case 422:
      return httpError(502, `dry-dock rejected the request: ${e.message}`);
    case 503:
      return httpError(503, "No dry-dock worker is online right now (machine asleep?). Try again shortly.");
    case 504:
      return httpError(504, "dry-dock timed out. Try revising one section at a time, or shorten the directions.");
    default:
      return httpError(502, e.message);
  }
}

function requireDrydock() {
  if (!drydockConfigured()) throw httpError(503, "dry-dock is not configured on the server.");
}

// ── Log ─────────────────────────────────────────────────────

proposalsRouter.get(
  "/",
  ah(async (req, res) => {
    const clauses = [];
    const params = [];
    if (req.query.status) {
      params.push(req.query.status);
      clauses.push(`p.status = $${params.length}`);
    }
    if (req.query.lead_id) {
      params.push(req.query.lead_id);
      clauses.push(`p.lead_id = $${params.length}`);
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const { rows } = await pool.query(
      `SELECT p.id, p.lead_id, p.status, p.tone, p.line_items, p.offer_discount,
              p.sent_at, p.sent_subject, p.outcome_note, p.created_at, p.updated_at,
              l.name AS lead_name, l.company AS lead_company,
              (SELECT COUNT(*) FROM proposal_versions v WHERE v.proposal_id = p.id)::int AS version_count
         FROM proposals p JOIN leads l ON l.id = p.lead_id
         ${where}
        ORDER BY COALESCE(p.sent_at, p.updated_at) DESC`,
      params
    );
    res.json(rows);
  })
);

// ── Create / read / update / delete ────────────────────────

proposalsRouter.post(
  "/",
  ah(async (req, res) => {
    const lead = await getLead(req.body?.lead_id);
    const s = await getSettings();
    // Snapshot the reusable text now so later settings edits don't rewrite
    // this proposal. Templates keep their {{variables}} until rendered.
    const { rows } = await pool.query(
      `INSERT INTO proposals (lead_id, layout, next_steps, signature, discount_percent, discount_intro)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [lead.id, s.email_layout, s.next_steps_template, s.signature, Number(s.discount_percent) || 0, s.discount_intro]
    );
    res.status(201).json(await view(rows[0].id));
  })
);

proposalsRouter.get(
  "/:id",
  ah(async (req, res) => {
    res.json(await view(req.params.id));
  })
);

const TEXT_FIELDS = [
  "approach_notes", "extra_details", "pricing_note", "layout",
  "next_steps", "signature", "discount_intro", "outcome_note",
];

proposalsRouter.put(
  "/:id",
  ah(async (req, res) => {
    await getProposal(req.params.id);
    const b = req.body || {};
    const data = {};
    for (const k of TEXT_FIELDS) if (k in b) data[k] = b[k] == null ? null : String(b[k]);
    if ("tone" in b) {
      if (!TONES[b.tone]) throw httpError(422, `tone must be one of: ${Object.keys(TONES).join(", ")}.`);
      data.tone = b.tone;
    }
    if ("line_items" in b) data.line_items = JSON.stringify(cleanLineItems(b.line_items));
    if ("offer_discount" in b) data.offer_discount = Boolean(b.offer_discount);
    if ("show_features" in b) data.show_features = Boolean(b.show_features);
    if ("show_yearly" in b) data.show_yearly = Boolean(b.show_yearly);
    if ("discount_percent" in b) {
      const n = Number(b.discount_percent);
      if (!Number.isFinite(n) || n < 0 || n > 100) throw httpError(422, "discount_percent must be 0–100.");
      data.discount_percent = n;
    }
    const cols = Object.keys(data);
    if (cols.length) {
      const vals = Object.values(data);
      vals.push(req.params.id);
      await pool.query(
        `UPDATE proposals SET ${cols.map((c, i) => `${c} = $${i + 1}`).join(", ")}, updated_at = now()
         WHERE id = $${vals.length}`,
        vals
      );
    }
    res.json(await view(req.params.id));
  })
);

proposalsRouter.delete(
  "/:id",
  ah(async (req, res) => {
    const { rowCount } = await pool.query("DELETE FROM proposals WHERE id = $1", [req.params.id]);
    if (!rowCount) throw httpError(404, "Proposal not found.");
    res.json({ ok: true });
  })
);

// ── Writing ─────────────────────────────────────────────────

proposalsRouter.post(
  "/:id/generate",
  ah(async (req, res) => {
    requireDrydock();
    const p = await getProposal(req.params.id);
    if (!(p.line_items || []).length) throw httpError(422, "Pick at least one offering before generating.");
    const lead = await getLead(p.lead_id);
    let out;
    try {
      out = await writeDraft(p, lead, await getSettings());
    } catch (e) {
      throw drydockError(e);
    }
    const version = await insertVersion(p.id, out.sections, { source: "generate", meta: out.meta });
    res.json({ version, warnings: out.warnings, meta: out.meta });
  })
);

// Body: { feedback, section?, base: {subject, intro, scope, questions, closing} }.
// `base` is what's on screen (hand edits included); falls back to the
// latest saved version.
proposalsRouter.post(
  "/:id/revise",
  ah(async (req, res) => {
    requireDrydock();
    const { feedback, section } = req.body || {};
    if (!feedback || !String(feedback).trim()) throw httpError(422, "Feedback is required to revise.");
    if (section && !SECTIONS.includes(section)) throw httpError(422, `section must be one of: ${SECTIONS.join(", ")}.`);
    const p = await getProposal(req.params.id);
    const lead = await getLead(p.lead_id);
    let base = req.body.base;
    if (!base) {
      const { rows } = await pool.query(
        "SELECT * FROM proposal_versions WHERE proposal_id = $1 ORDER BY version DESC LIMIT 1",
        [p.id]
      );
      if (!rows[0]) throw httpError(422, "Generate a first draft before revising.");
      base = rows[0];
    }
    let out;
    try {
      out = await reviseDraft(p, lead, await getSettings(), pick(base), String(feedback).trim(), section);
    } catch (e) {
      throw drydockError(e);
    }
    const version = await insertVersion(p.id, out.sections, {
      source: section ? `revise:${section}` : "revise",
      feedback: String(feedback).trim(),
      meta: out.meta,
    });
    res.json({ version, warnings: out.warnings, meta: out.meta });
  })
);

// Save hand edits as their own version.
proposalsRouter.post(
  "/:id/versions",
  ah(async (req, res) => {
    const p = await getProposal(req.params.id);
    const version = await insertVersion(p.id, req.body || {}, {
      source: "manual",
      feedback: req.body?.note || null,
    });
    res.status(201).json({ version });
  })
);

// ── Sending + outcome ──────────────────────────────────────

const EARLY_STAGES = ["new", "contacted", "qualified"];

proposalsRouter.post(
  "/:id/send",
  ah(async (req, res) => {
    const p = await getProposal(req.params.id);
    const { rows } = await pool.query(
      "SELECT * FROM proposal_versions WHERE id = $1 AND proposal_id = $2",
      [req.body?.version_id, p.id]
    );
    const version = rows[0];
    if (!version) throw httpError(422, "Pick a saved version to mark as sent.");
    const lead = await getLead(p.lead_id);
    const content = assembleEmail(p, lead, version);
    await pool.query(
      `UPDATE proposals SET status = 'sent', sent_at = now(), sent_subject = $1,
              sent_content = $2, sent_version_id = $3, updated_at = now()
        WHERE id = $4`,
      [version.subject, content, version.id, p.id]
    );
    // Move the lead into the proposal stage, but never backwards from won/lost.
    await pool.query(
      `UPDATE leads SET
         status = CASE WHEN status = ANY($2) THEN 'proposal' ELSE status END,
         last_contact_date = CURRENT_DATE, updated_at = now()
       WHERE id = $1`,
      [lead.id, EARLY_STAGES]
    );
    res.json(await view(p.id));
  })
);

proposalsRouter.post(
  "/:id/outcome",
  ah(async (req, res) => {
    const { status, note } = req.body || {};
    if (!["won", "lost", "sent"].includes(status)) throw httpError(422, "status must be won, lost, or sent.");
    const p = await getProposal(req.params.id);
    if (p.status === "draft") throw httpError(422, "Mark the proposal as sent first.");
    await pool.query(
      "UPDATE proposals SET status = $1, outcome_note = COALESCE($2, outcome_note), updated_at = now() WHERE id = $3",
      [status, note ?? null, p.id]
    );
    if (status !== "sent") {
      await pool.query("UPDATE leads SET status = $1, updated_at = now() WHERE id = $2", [status, p.lead_id]);
    }
    res.json(await view(p.id));
  })
);

// ── Phase 2 seam ────────────────────────────────────────────
// Import a proposal sent before Seedbook had this feature: { lead_id,
// sent_at, subject, content, outcome }. Lands as a sent/won/lost row with no
// versions, so it shows in the log and can feed the style-guide distiller.
proposalsRouter.post("/import", (req, res) => {
  res.status(501).json({
    error: "Not built yet: importing past proposals is phase 2.",
  });
});
