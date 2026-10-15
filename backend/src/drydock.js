// Client for the dry-dock generate API (see DRYDOCK-API.md in the dry-dock
// repo). One blocking call → generated text. Used to draft sales follow-ups
// and proposals.

const BASE_URL = process.env.DRYDOCK_BASE_URL || "";
const API_KEY = process.env.DRYDOCK_API_KEY || "";
const POOL = process.env.DRYDOCK_POOL || "researcher";

export function drydockConfigured() {
  return Boolean(BASE_URL && API_KEY);
}

export function defaultPool() {
  return POOL;
}

async function post(body) {
  const res = await fetch(`${BASE_URL.replace(/\/$/, "")}/api/v1/generate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": API_KEY,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const err = new Error(`dry-dock generate ${res.status}: ${text}`);
    // Carried through so routes can tell "config wrong" (401) from
    // "machine asleep" (503) from "prompt too long for the timeout" (504).
    err.status = res.status;
    throw err;
  }
  return res.json();
}

// Raw generate call. Returns { content, model, worker, pool, elapsed_ms }.
//
// `pool`: undefined → DRYDOCK_POOL; "" / null → unpinned (dry-dock walks its
// own pool order, which survives a sleeping MacBook); otherwise that pool.
export async function generate({ system, prompt, messages, model, timeout, pool }) {
  if (!drydockConfigured()) {
    const err = new Error(
      "dry-dock is not configured (set DRYDOCK_BASE_URL and DRYDOCK_API_KEY)."
    );
    err.status = 503;
    throw err;
  }
  const pinned = pool === undefined ? POOL : pool || undefined;
  try {
    return await post({ system, prompt, messages, model, pool: pinned, timeout });
  } catch (e) {
    // 503 = no worker online in that pool. A pinned pool is the usual reason
    // (MacBook asleep), so retry once unpinned before giving up.
    if (e.status === 503 && pinned) {
      return post({ system, prompt, messages, model, timeout });
    }
    throw e;
  }
}

const SYSTEM_PROMPT = `You are an assistant to an independent software
developer who runs a consulting business. You draft warm, specific,
low-pressure sales follow-up messages to prospective clients. Write in the
first person as the developer. Keep it concise (3-6 sentences), reference the
concrete details provided, propose a clear next step, and avoid generic filler
or hard-sell language. Return only the message body — no subject line, no
placeholders like [Name], use the real details given.`;

// Build a prompt from a lead row and ask dry-dock for a follow-up draft.
export async function generateFollowup(lead, extraContext) {
  const fields = [
    ["Name", lead.name],
    ["Company", lead.company],
    ["Title", lead.title],
    ["Relationship / how we know each other", lead.relationship],
    ["Their potential business needs", lead.business_needs],
    ["Planned next steps", lead.next_steps],
    ["Status", lead.status],
    ["Notes", lead.notes],
  ].filter(([, v]) => v && String(v).trim());

  const details = fields.map(([k, v]) => `- ${k}: ${v}`).join("\n");
  const prompt =
    `Draft a follow-up message to this sales lead.\n\n${details}` +
    (extraContext ? `\n\nAdditional instructions: ${extraContext}` : "");

  const result = await generate({ system: SYSTEM_PROMPT, prompt });
  return result; // { content, model, worker, ... }
}
