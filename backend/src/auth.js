// Auth: first account created becomes the admin (mirrors dry-dock's setup
// flow). Sessions are a signed cookie — HMAC over the user id, verified on
// each request. No server-side session table.
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { pool, usersExist } from "./db.js";

const COOKIE = "seedbook_session";
const SECRET = process.env.SESSION_SECRET || "dev-only-change-me";
const MAX_AGE_MS = 1000 * 60 * 60 * 24 * 30; // 30 days

function sign(value) {
  const mac = crypto.createHmac("sha256", SECRET).update(value).digest("base64url");
  return `${value}.${mac}`;
}

function verify(signed) {
  if (!signed || !signed.includes(".")) return null;
  const idx = signed.lastIndexOf(".");
  const value = signed.slice(0, idx);
  const mac = signed.slice(idx + 1);
  const expected = crypto
    .createHmac("sha256", SECRET)
    .update(value)
    .digest("base64url");
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  // value = `${userId}:${expiresAtMs}`
  const [userId, expiresAt] = value.split(":");
  if (!userId || !expiresAt || Date.now() > Number(expiresAt)) return null;
  return userId;
}

function setSessionCookie(res, userId) {
  const value = `${userId}:${Date.now() + MAX_AGE_MS}`;
  res.cookie(COOKIE, sign(value), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.SESSION_HTTPS_ONLY !== "false",
    maxAge: MAX_AGE_MS,
  });
}

export function clearSessionCookie(res) {
  res.clearCookie(COOKIE);
}

// Middleware: attach req.userId or 401.
export async function requireAuth(req, res, next) {
  const userId = verify(req.cookies?.[COOKIE]);
  if (!userId) return res.status(401).json({ error: "Not authenticated." });
  req.userId = userId;
  next();
}

export function registerAuthRoutes(app) {
  // Whether setup is still available (no users yet).
  app.get("/api/auth/status", async (req, res) => {
    const exists = await usersExist();
    const userId = verify(req.cookies?.[COOKIE]);
    res.json({ needsSetup: !exists, authenticated: Boolean(userId) });
  });

  // First-run: create the admin account. Refuses once any user exists.
  app.post("/api/auth/setup", async (req, res) => {
    const { email, password } = req.body || {};
    if (await usersExist()) {
      return res.status(409).json({ error: "Setup already completed." });
    }
    if (!email || !password || password.length < 8) {
      return res
        .status(422)
        .json({ error: "Email and a password of 8+ characters are required." });
    }
    const hash = await bcrypt.hash(password, 12);
    const { rows } = await pool.query(
      `INSERT INTO users (email, password_hash, is_admin)
       VALUES ($1, $2, TRUE) RETURNING id`,
      [String(email).toLowerCase().trim(), hash]
    );
    setSessionCookie(res, rows[0].id);
    res.json({ ok: true });
  });

  app.post("/api/auth/login", async (req, res) => {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(422).json({ error: "Email and password required." });
    }
    const { rows } = await pool.query(
      "SELECT id, password_hash FROM users WHERE email = $1",
      [String(email).toLowerCase().trim()]
    );
    const user = rows[0];
    const ok = user && (await bcrypt.compare(password, user.password_hash));
    if (!ok) return res.status(401).json({ error: "Invalid email or password." });
    setSessionCookie(res, user.id);
    res.json({ ok: true });
  });

  app.post("/api/auth/logout", (req, res) => {
    clearSessionCookie(res);
    res.json({ ok: true });
  });
}
