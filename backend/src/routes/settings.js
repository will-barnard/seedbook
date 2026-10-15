// Proposal settings (next-steps template, discount wording, signature,
// style guide, writing pool).
import express from "express";
import { getSettings, updateSettings } from "../services/settings.js";
import { defaultPool } from "../drydock.js";
import { ah } from "./asyncHandler.js";

export const settingsRouter = express.Router();

settingsRouter.get(
  "/",
  ah(async (req, res) => {
    res.json({ ...(await getSettings()), _default_pool: defaultPool() });
  })
);

settingsRouter.put(
  "/",
  ah(async (req, res) => {
    res.json({ ...(await updateSettings(req.body)), _default_pool: defaultPool() });
  })
);

// ── Phase 2 seam ────────────────────────────────────────────
// Distil a style guide from past proposals: send the logged/imported
// proposals to dry-dock, get back a short description of how Will writes
// (openings, how he frames price, length, phrases), and save it to
// settings.style_guide for him to edit. Until then the style guide is
// written by hand on the settings page and is already used in every prompt.
settingsRouter.post("/style-guide/distill", (req, res) => {
  res.status(501).json({
    error: "Not built yet: distilling a style guide from past proposals is phase 2. Write it by hand in settings for now.",
  });
});
