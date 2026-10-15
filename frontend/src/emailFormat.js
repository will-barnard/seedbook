// Turns the proposal's small markdown subset into something you can paste
// into an email: rich HTML (Gmail/Apple Mail keep bold, lists and links) or
// plain text. Supported: paragraphs, "- " and "1. " lists, **bold**,
// [text](url). Everything else is escaped and shown as written.

function escapeHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function safeUrl(u) {
  return /^(https?:|mailto:)/i.test(u) ? u : null;
}

function inlineHtml(s) {
  return escapeHtml(s)
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, text, url) => {
      const href = safeUrl(url.replace(/&amp;/g, "&"));
      return href ? `<a href="${escapeHtml(href)}">${text}</a>` : m;
    })
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
}

function inlinePlain(s) {
  return s
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, text, url) =>
      // [will-barnard.com](https://will-barnard.com) → just the text; it's already the address.
      text === url || url.replace(/^https?:\/\//, "").replace(/\/$/, "") === text ? text : `${text} (${url})`
    )
    .replace(/\*\*([^*]+)\*\*/g, "$1");
}

// Blank-line-separated paragraphs, each split into runs of
// {type: "p"|"ul"|"ol", lines[]} — so a bold label followed directly by list
// lines (no blank line between) stays one visual unit.
function paragraphs(md) {
  return String(md || "")
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map((para) => {
      const runs = [];
      let cur = null;
      for (const line of para.split("\n")) {
        if (!line.trim()) continue;
        const type = /^\s*- /.test(line) ? "ul" : /^\s*\d+\.\s/.test(line) ? "ol" : "p";
        const text =
          type === "ul" ? line.replace(/^\s*- /, "") : type === "ol" ? line.replace(/^\s*\d+\.\s/, "") : line;
        if (!cur || cur.type !== type) {
          cur = { type, lines: [] };
          runs.push(cur);
        }
        cur.lines.push(text);
      }
      return runs;
    })
    .filter((runs) => runs.length);
}

export function toHtml(md) {
  return paragraphs(md)
    .flat()
    .map((b) => {
      if (b.type === "p") return `<p>${b.lines.map(inlineHtml).join("<br>")}</p>`;
      const items = b.lines.map((l) => `<li>${inlineHtml(l)}</li>`).join("");
      return `<${b.type}>${items}</${b.type}>`;
    })
    .join("\n");
}

export function toPlain(md) {
  return paragraphs(md)
    .map((runs) =>
      runs
        .map((b) => {
          if (b.type === "p") return b.lines.map(inlinePlain).join("\n");
          if (b.type === "ul") return b.lines.map((l) => `- ${inlinePlain(l)}`).join("\n");
          return b.lines.map((l, i) => `${i + 1}. ${inlinePlain(l)}`).join("\n");
        })
        .join("\n")
    )
    .join("\n\n");
}

// Fill {{variables}} and tidy the gap an empty one leaves. The values come
// from the server (rendered prices etc.) — no price math happens here.
// MIRROR of renderTemplate in backend/src/services/proposalText.js.
export function renderTemplate(tpl, vars) {
  return String(tpl || "")
    .replace(/\{\{\s*(\w+)\s*\}\}/g, (m, k) => (vars[k] !== undefined && vars[k] !== null ? String(vars[k]) : m))
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// Fill an email layout. The layout is blank-line-separated chunks; a chunk
// that is only a **Heading** is dropped when the placeholder chunk right
// after it renders empty, so an unused section takes its heading with it.
//
// MIRROR of renderLayout in backend/src/services/proposalText.js, which
// builds what's logged on send. Keep the two in sync.
export function renderLayout(layout, parts) {
  const chunks = String(layout || "").replace(/\r\n/g, "\n").split(/\n{2,}/);
  const out = [];
  let heading = null;
  for (const raw of chunks) {
    const chunk = raw.trim();
    if (!chunk) continue;
    if (/^\*\*[^*\n]+\*\*$/.test(chunk)) {
      if (heading) out.push(heading);
      heading = chunk;
      continue;
    }
    const filled = chunk
      .replace(/\{\{\s*(\w+)\s*\}\}/g, (m, k) => (k in parts ? String(parts[k] ?? "").trim() : m))
      .trim();
    const onlyPlaceholder = /^\{\{\s*\w+\s*\}\}$/.test(chunk);
    if (onlyPlaceholder && !filled) {
      heading = null; // empty section → its heading goes too
      continue;
    }
    if (heading) {
      out.push(heading);
      heading = null;
    }
    if (filled) out.push(filled);
  }
  if (heading) out.push(heading);
  return out.join("\n\n");
}

// Copies rich text with a plain-text fallback in the same clipboard write,
// so whichever the mail client prefers, it gets something sensible.
export async function copyForEmail(md) {
  const html = toHtml(md);
  const plain = toPlain(md);
  if (window.ClipboardItem && navigator.clipboard?.write) {
    await navigator.clipboard.write([
      new ClipboardItem({
        "text/html": new Blob([html], { type: "text/html" }),
        "text/plain": new Blob([plain], { type: "text/plain" }),
      }),
    ]);
  } else {
    await navigator.clipboard.writeText(plain);
  }
}

// Things worth a second look before the draft goes out.
// `tierNames`: offering names being quoted ("Professional"…) — the model is
// told nothing about tiers, so one turning up in its prose is worth a flag.
export function lint(sections, tierNames = []) {
  const warns = [];
  const tierRe = tierNames.length
    ? new RegExp(`\\b(${tierNames.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\s+(tier|plan|package)\\b`, "i")
    : null;
  for (const [k, v] of Object.entries(sections || {})) {
    if (!v) continue;
    if (tierRe && tierRe.test(v)) warns.push(`The ${k} mentions a tier — that belongs in "My end of things".`);
    if (/\$\s?\d/.test(v)) warns.push(`The ${k} mentions a dollar amount — prices should only come from the pricing block.`);
    if (/\d+\s?%/.test(v)) warns.push(`The ${k} mentions a percentage — check it matches the discount.`);
    if (/\[(?:your|client|name|company)[^\]]*\](?!\()/i.test(v)) warns.push(`The ${k} has a placeholder like [Name].`);
  }
  return warns;
}
