// Proposal prose via dry-dock: first drafts, whole-draft revisions, and
// single-section rewrites.
//
// The model writes five parts — SUBJECT, INTRO, SCOPE, QUESTIONS, CLOSING —
// and is shown the email layout (headings, fixed text, where pricing and
// next steps land) so its parts read as one email. It is never shown a
// price. Structure comes entirely from this system prompt: dry-dock's
// generate API is a plain chat call whatever pool it lands on.
import { generate } from "../drydock.js";
import { firstName } from "./proposalText.js";

export const SECTIONS = ["subject", "intro", "scope", "questions", "closing"];
// Sections that may legitimately come back empty.
const OPTIONAL = new Set(["questions"]);

export const TONES = {
  professional:
    "Professional: polished and confident but still personal. Clear, complete sentences; no slang; no exclamation marks.",
  casual:
    "Casual: relaxed and friendly, like writing to people you've already met. Contractions, plain words, short sentences. Warm, but clearly competent.",
};

const FIXED_DESCRIPTIONS = {
  pricing: "[inserted automatically: the tier(s) and exact prices]",
  pricing_note: "[inserted automatically: Will's own note about pricing, if any]",
  next_steps:
    "[inserted automatically: numbered next steps — set up a domain on Cloudflare, create an account and pay the build fee, send creative assets]",
  signature: "[inserted automatically: signature]",
};

// Turn the layout into a plain description the model can follow, so its
// sections fit between the headings and fixed blocks Will actually uses.
function describeLayout(layout) {
  const lines = [];
  for (const raw of String(layout || "").split(/\n{2,}/)) {
    const chunk = raw.trim();
    if (!chunk) continue;
    const heading = chunk.match(/^\*\*([^*\n]+)\*\*$/);
    const ph = chunk.match(/^\{\{\s*(\w+)\s*\}\}$/);
    if (heading) lines.push(`Heading: "${heading[1]}"`);
    else if (ph && SECTIONS.includes(ph[1])) lines.push(`[YOU WRITE: ${ph[1].toUpperCase()}]`);
    else if (ph && FIXED_DESCRIPTIONS[ph[1]]) lines.push(FIXED_DESCRIPTIONS[ph[1]]);
    else lines.push(`Fixed text: "${chunk.replace(/\s+/g, " ").slice(0, 120)}"`);
  }
  return lines.map((l, i) => `${i + 1}. ${l}`).join("\n");
}

// The example is Will's real writing, so it contains real prices. Strip them
// before the model sees it — it's there for voice, and the one rule that
// matters most is that the model never writes a number.
function redactPrices(text) {
  return String(text || "")
    .replace(/\$\s?[\d,]+(?:\.\d+)?(?:\s*(?:\/|per)\s*(?:month|mo|year|yr))?/gi, "[price]")
    .replace(/\b\d+\s?%/g, "[percent]");
}

function systemPrompt(settings, layout) {
  const parts = [
    `You write sales proposal emails for Will, an independent web developer. Write in the first person as Will. It is sent as a normal email, not a document.`,
  ];
  if (settings.business_summary?.trim()) {
    parts.push(`About Will's business, in his words:\n${settings.business_summary.trim()}`);
  }
  parts.push(`The email is laid out like this. You write only the parts marked YOU WRITE; everything else is added automatically:
${describeLayout(layout)}

What each part you write should be:
- SUBJECT: one line, under 70 characters, no quotes.
- INTRO: a greeting using their first name (if Will's notes say there are several people, greet them as a group), then one to three short sentences — the meeting or context, and that you're excited about the project.
- SCOPE: one short lead-in line, then a "- " bullet list of concrete things the site will do or that were agreed, one line each. Include anything explicitly out of scope for v1 if the notes mention it. Use only details you were given.
- QUESTIONS: a "- " bullet list of open questions Will needs answered, taken from his notes and the client details. Don't ask about anything the next steps already cover (domain, account, sending assets). If there are no genuine open questions, leave it empty.
- CLOSING: one short line that comes last, after the next steps. No sign-off, no name.

Rules:
- Never state a price, fee, dollar amount, percentage or discount. Pricing is inserted for you.
- Don't write headings — they're in the layout.
- No markdown other than "- " bullets and occasional **bold**. No placeholders like [Name].
- Don't invent facts about the client or the project.

Reply in exactly this format and nothing else:
=== SUBJECT ===
...
=== INTRO ===
...
=== SCOPE ===
...
=== QUESTIONS ===
...
=== CLOSING ===
...`);
  if (settings.style_guide?.trim()) {
    parts.push(`Will's style guide — follow it closely:\n${settings.style_guide.trim()}`);
  }
  if (settings.example_proposal?.trim()) {
    parts.push(
      `A proposal Will wrote himself, to a different client. Match its voice, sentence length and level of detail. Do NOT reuse its content, names or project details.\n"""\n${redactPrices(settings.example_proposal.trim())}\n"""`
    );
  }
  return parts.join("\n\n");
}

function briefing(p, lead) {
  const client = [
    ["Name", lead.name && `${lead.name} (first name: ${firstName(lead)})`],
    ["Company", lead.company],
    ["Title", lead.title],
    ["How Will knows them", lead.relationship],
    ["What they need", lead.business_needs],
    ["Other notes (private context — don't quote)", lead.notes],
  ]
    .filter(([, v]) => v && String(v).trim())
    .map(([k, v]) => `- ${k}: ${v}`)
    .join("\n");

  const items = (p.line_items || [])
    .map((i) => {
      const label = i.offering_id ? `${i.name} tier` : i.name;
      const feats = i.features?.length ? ` Includes: ${i.features.join("; ")}.` : "";
      return `- ${label}${i.tagline ? `: ${i.tagline}.` : "."}${feats}`;
    })
    .join("\n");

  const lines = [
    `Write a proposal email for this client.`,
    `CLIENT\n${client}`,
    `TONE\n${TONES[p.tone] || TONES.professional}`,
  ];
  if (p.approach_notes?.trim()) lines.push(`WILL'S DIRECTIONS\n${p.approach_notes.trim()}`);
  if (p.extra_details?.trim()) lines.push(`WILL'S NOTES FOR THIS PROPOSAL (scope, open questions, context)\n${p.extra_details.trim()}`);
  let offer = `WHAT IS BEING OFFERED (prices are inserted separately — don't mention them)\n${items}`;
  if ((p.line_items || []).length > 1) {
    offer += `\n- More than one option is being quoted; help them see which fits.`;
  }
  if (p.offer_discount) {
    offer += `\n- The pricing includes Will's usual friends discount. Don't describe it; it's spelled out below your text.`;
  }
  lines.push(offer);
  return lines.join("\n\n");
}

export function formatDraft(s) {
  return SECTIONS.map((k) => `=== ${k.toUpperCase()} ===\n${(s?.[k] || "").trim()}`).join("\n");
}

// Lenient on purpose: local models drift to "**SCOPE**", "## Scope" or
// "SCOPE:" even when told the exact format.
const MARKER =
  /^[ \t]*(?:={2,}|#{1,4}|\*\*)?[ \t]*(SUBJECT|INTRO|SCOPE|QUESTIONS|CLOSING)[ \t]*(?:={2,}|\*\*)?[ \t]*:?[ \t]*$/gim;

function stripFences(t) {
  return t.replace(/^```[a-z]*\s*$/gim, "").trim();
}

// Drop a trailing "Best,\nWill" the model adds despite being told not to.
function stripSignoff(text) {
  const lines = text.trimEnd().split("\n");
  const from = Math.max(0, lines.length - 3);
  for (let i = lines.length - 1; i >= from; i--) {
    if (
      /^(best|thanks|thank you|cheers|regards|best regards|kind regards|warm regards|sincerely|talk soon|warmly|all the best)\b[^.?]{0,20}[,!.]?\s*$/i.test(
        lines[i].trim()
      ) &&
      lines.length - i <= 3
    ) {
      return lines.slice(0, i).join("\n").trimEnd();
    }
  }
  return text.trim();
}

// "None", "N/A", "No open questions." → empty, so the section and its
// heading drop out of the email.
function emptyish(t) {
  return /^(none|n\/a|no (open )?questions?[^\n]*|-)\.?$/i.test(t.trim()) ? "" : t;
}

function tidy(key, text) {
  let t = text.trim();
  if (key === "subject") t = t.split("\n")[0].replace(/^subject:\s*/i, "").replace(/^["']|["']$/g, "").trim();
  if (key === "closing") t = stripSignoff(t);
  if (key === "questions") t = emptyish(t);
  return t;
}

export function parseDraft(raw) {
  const text = stripFences(String(raw || ""));
  const hits = [...text.matchAll(MARKER)];
  const out = Object.fromEntries(SECTIONS.map((k) => [k, ""]));
  const warnings = [];
  if (!hits.length) {
    const m = text.match(/^subject:\s*(.+)$/im);
    if (m) out.subject = m[1].trim();
    out.intro = text.replace(/^subject:.*$/im, "").trim();
    warnings.push("The model didn't follow the section format, so the whole reply landed in the intro.");
    return { sections: out, warnings };
  }
  hits.forEach((h, idx) => {
    const key = h[1].toLowerCase();
    const start = h.index + h[0].length;
    const end = idx + 1 < hits.length ? hits[idx + 1].index : text.length;
    out[key] = tidy(key, text.slice(start, end));
  });
  for (const k of SECTIONS) if (!out[k] && !OPTIONAL.has(k)) warnings.push(`The model left the ${k} empty.`);
  return { sections: out, warnings };
}

// For a single-section reply: the model sometimes repeats the marker anyway.
function cleanSection(raw, section) {
  let t = stripFences(String(raw || ""));
  const hits = [...t.matchAll(MARKER)];
  const own = hits.find((h) => h[1].toLowerCase() === section);
  if (own) {
    const next = hits.find((h) => h.index > own.index);
    t = t.slice(own.index + own[0].length, next ? next.index : t.length);
  }
  return tidy(section, t);
}

function poolFor(settings) {
  const v = (settings.proposal_pool || "").trim();
  if (v === "") return undefined; // DRYDOCK_POOL
  if (v === "auto") return ""; // unpinned
  return v;
}

function meta(r) {
  // `model` echoes what was requested (null here); worker + pool are the
  // truthful fields, so those are what get stored.
  return { worker: r.worker || null, pool: r.pool || null, elapsed_ms: r.elapsed_ms ?? null };
}

export async function writeDraft(p, lead, settings) {
  const r = await generate({
    system: systemPrompt(settings, p.layout),
    prompt: briefing(p, lead),
    pool: poolFor(settings),
  });
  const { sections, warnings } = parseDraft(r.content);
  return { sections, warnings, meta: meta(r) };
}

// `base` is the draft as Will currently sees it, hand edits included, so the
// model revises his text rather than its own earlier version.
export async function reviseDraft(p, lead, settings, base, feedback, section) {
  const messages = [
    { role: "system", content: systemPrompt(settings, p.layout) },
    { role: "user", content: briefing(p, lead) },
    { role: "assistant", content: formatDraft(base) },
  ];
  if (section) {
    messages.push({
      role: "user",
      content: `Rewrite only the ${section.toUpperCase()} section, based on this feedback from Will:\n${feedback}\n\nKeep it consistent with the other sections. Reply with only the new ${section.toUpperCase()} text — no marker line, nothing else.`,
    });
  } else {
    messages.push({
      role: "user",
      content: `Revise the draft based on this feedback from Will:\n${feedback}\n\nKeep whatever the feedback doesn't touch. Reply with all five sections in the same format.`,
    });
  }
  const r = await generate({ messages, pool: poolFor(settings) });

  if (section) {
    const text = cleanSection(r.content, section);
    // An empty QUESTIONS rewrite is a valid answer ("there aren't any").
    const keep = !text && !OPTIONAL.has(section);
    return {
      sections: { ...pick(base), [section]: keep ? base[section] || "" : text },
      warnings: keep ? [`The model returned an empty ${section}; kept the previous text.`] : [],
      meta: meta(r),
    };
  }
  const { sections, warnings } = parseDraft(r.content);
  // A required section the model dropped falls back to the base rather than
  // vanishing.
  for (const k of SECTIONS) if (!sections[k] && !OPTIONAL.has(k) && base[k]) sections[k] = base[k];
  const kept = warnings.filter(
    (w) => !SECTIONS.some((k) => w === `The model left the ${k} empty.` && sections[k])
  );
  return { sections, warnings: kept, meta: meta(r) };
}

export function pick(s) {
  const out = {};
  for (const k of SECTIONS) out[k] = typeof s?.[k] === "string" ? s[k] : "";
  return out;
}
