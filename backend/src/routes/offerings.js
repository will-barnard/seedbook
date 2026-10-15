// Rate card CRUD. Deleting an offering is safe for past proposals — they
// carry their own snapshot in proposals.line_items — but "active: false"
// is usually what you want so it drops off the picker without vanishing.
import express from "express";
import { pool } from "../db.js";
import { ah, httpError } from "./asyncHandler.js";

export const offeringsRouter = express.Router();

function clean(body, { partial = false } = {}) {
  const out = {};
  if ("name" in body || !partial) {
    const name = String(body.name || "").trim();
    if (!name) throw httpError(422, "An offering needs a name.");
    out.name = name;
  }
  if ("tagline" in body) out.tagline = String(body.tagline || "").trim() || null;
  if ("features" in body) {
    const f = Array.isArray(body.features)
      ? body.features
      : String(body.features || "").split("\n");
    out.features = JSON.stringify(f.map((s) => String(s).trim()).filter(Boolean));
  }
  for (const k of ["build_fee", "monthly_fee"]) {
    if (k in body) {
      const n = Number(body[k] || 0);
      if (!Number.isFinite(n) || n < 0) throw httpError(422, `${k} must be a non-negative number.`);
      out[k] = Math.round(n * 100) / 100;
    }
  }
  if ("sort_order" in body) out.sort_order = parseInt(body.sort_order, 10) || 0;
  if ("discount_eligible" in body) out.discount_eligible = Boolean(body.discount_eligible);
  if ("active" in body) out.active = Boolean(body.active);
  return out;
}

offeringsRouter.get(
  "/",
  ah(async (req, res) => {
    const where = req.query.active ? "WHERE active" : "";
    const { rows } = await pool.query(
      `SELECT * FROM offerings ${where} ORDER BY sort_order, name`
    );
    res.json(rows);
  })
);

offeringsRouter.post(
  "/",
  ah(async (req, res) => {
    const data = clean(req.body || {});
    const cols = Object.keys(data);
    const { rows } = await pool.query(
      `INSERT INTO offerings (${cols.join(", ")})
       VALUES (${cols.map((_, i) => `$${i + 1}`).join(", ")}) RETURNING *`,
      Object.values(data)
    );
    res.status(201).json(rows[0]);
  })
);

offeringsRouter.put(
  "/:id",
  ah(async (req, res) => {
    const data = clean(req.body || {}, { partial: true });
    const cols = Object.keys(data);
    if (!cols.length) throw httpError(422, "Nothing to update.");
    const vals = Object.values(data);
    vals.push(req.params.id);
    const { rows } = await pool.query(
      `UPDATE offerings SET ${cols.map((c, i) => `${c} = $${i + 1}`).join(", ")}, updated_at = now()
       WHERE id = $${vals.length} RETURNING *`,
      vals
    );
    if (!rows[0]) throw httpError(404, "Offering not found.");
    res.json(rows[0]);
  })
);

offeringsRouter.delete(
  "/:id",
  ah(async (req, res) => {
    const { rowCount } = await pool.query("DELETE FROM offerings WHERE id = $1", [req.params.id]);
    if (!rowCount) throw httpError(404, "Offering not found.");
    res.json({ ok: true });
  })
);
