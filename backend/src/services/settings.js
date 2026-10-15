// Proposal settings: reusable text written once (next-steps template,
// discount wording, signature, style guide) plus the writing pool.
// Stored as rows in `settings`; seeded by migration 002.
import { pool } from "../db.js";

export const SETTING_KEYS = [
  "business_summary",
  "email_layout",
  "next_steps_template",
  "discount_percent",
  "discount_intro",
  "signature",
  "style_guide",
  "example_proposal",
  "proposal_pool",
];

// Fallbacks if a row is missing (e.g. someone deleted it by hand). Kept
// deliberately plain — the real defaults live in the migration seed.
const DEFAULTS = {
  business_summary: "",
  email_layout:
    "{{intro}}\n\n{{scope}}\n\n{{questions}}\n\n{{pricing}}\n\n{{pricing_note}}\n\n{{next_steps}}\n\n{{closing}}\n\n{{signature}}",
  next_steps_template: "",
  discount_percent: "50",
  discount_intro:
    "I usually offer a {{percent}}% friends discount — your choice of either the build fee or the monthly fee:",
  signature: "",
  style_guide: "",
  example_proposal: "",
  proposal_pool: "",
};

export async function getSettings() {
  const { rows } = await pool.query(
    "SELECT key, value FROM settings WHERE key = ANY($1)",
    [SETTING_KEYS]
  );
  const out = { ...DEFAULTS };
  for (const r of rows) out[r.key] = r.value;
  return out;
}

// Upsert only known keys; anything else in the patch is ignored.
export async function updateSettings(patch) {
  const entries = Object.entries(patch || {}).filter(([k]) => SETTING_KEYS.includes(k));
  for (const [key, raw] of entries) {
    let value = raw == null ? "" : String(raw);
    if (key === "discount_percent") {
      const n = Number(value);
      if (!Number.isFinite(n) || n < 0 || n > 100) {
        const err = new Error("discount_percent must be a number from 0 to 100.");
        err.status = 422;
        throw err;
      }
      value = String(n);
    }
    await pool.query(
      `INSERT INTO settings (key, value, updated_at) VALUES ($1, $2, now())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      [key, value]
    );
  }
  return getSettings();
}
