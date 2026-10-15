// Deterministic proposal text: pricing, next steps, and the assembled email.
//
// Nothing in here touches the model. Prices are rendered from the proposal's
// line_items snapshot so a draft can never quote a number the rate card
// didn't produce, and the discount math happens in code, not in prose.
//
// Output is a small markdown subset — paragraphs, "- " and "1. " lists,
// **bold**, [links](url) — which the frontend turns into rich text or plain
// text for pasting into an email.

// Yearly billing is always 10× whatever monthly is being quoted, including a
// discounted monthly ($5/mo → $50/yr).
export const YEARLY_MULTIPLIER = 10;

export function money(n) {
  const v = Math.round(Number(n || 0) * 100) / 100;
  return Number.isInteger(v)
    ? `$${v.toLocaleString("en-US")}`
    : `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function fillTemplate(tpl, vars) {
  return String(tpl || "").replace(/\{\{\s*(\w+)\s*\}\}/g, (m, k) =>
    vars[k] !== undefined && vars[k] !== null ? String(vars[k]) : m
  );
}

export function firstName(lead) {
  return String(lead?.name || "").trim().split(/\s+/)[0] || "";
}

// Items that came from the rate card read as tiers ("Professional tier");
// custom line items keep their own name.
function itemLabel(item) {
  return item.offering_id ? `${item.name} tier` : item.name;
}

// `"Professional tier"` or `"Professional tier" or "Commerce tier"` — fills
// {{tier}} in the next-steps template, matching how Will phrases it.
export function tierLabel(items) {
  const names = (items || []).map((i) => `"${itemLabel(i)}"`);
  if (names.length <= 1) return names[0] || '"build"';
  return `${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}`;
}

function priceLine(build, monthly, { bold = false, yearly = true } = {}) {
  const b = (s) => (bold ? `**${s}**` : s);
  const mo = monthly > 0
    ? b(`${money(monthly)}/month`) + (yearly ? ` (or ${money(monthly * YEARLY_MULTIPLIER)}/year)` : "")
    : "";
  if (build > 0 && monthly > 0) return `${b(money(build))} build fee, then ${mo}`;
  if (build > 0) return `${b(money(build))} one-time`;
  if (monthly > 0) return mo;
  return "Included";
}

function off(amount, pct) {
  return Math.round(amount * (1 - pct / 100) * 100) / 100;
}

export function renderPricing(p) {
  const items = p.line_items || [];
  if (!items.length) return "";
  const many = items.length > 1;
  const pct = Number(p.discount_percent ?? 50);
  const yearly = p.show_yearly !== false;
  const blocks = [];

  for (const item of items) {
    const build = Number(item.build_fee);
    const monthly = Number(item.monthly_fee);
    if (p.show_features) {
      // Long form: tier, tagline, what's included, then the price.
      const lines = [`**${itemLabel(item)}**` + (item.tagline ? ` — ${item.tagline}` : "")];
      if (item.features?.length) lines.push(...item.features.map((f) => `- ${f}`));
      blocks.push(lines.join("\n"));
      blocks.push(priceLine(build, monthly, { bold: true, yearly }));
    } else {
      // Short form, the way Will writes it: tier name and price on one line.
      blocks.push(`**${itemLabel(item)}**: ${priceLine(build, monthly, { yearly })}`);
    }
  }

  if (p.offer_discount && pct > 0) {
    const eligible = items.filter(
      (i) => i.discount_eligible !== false && (Number(i.build_fee) > 0 || Number(i.monthly_fee) > 0)
    );
    if (eligible.length) {
      const lines = [fillTemplate(p.discount_intro, { percent: pct })];
      for (const item of eligible) {
        const build = Number(item.build_fee);
        const monthly = Number(item.monthly_fee);
        if (many) lines.push(`**${itemLabel(item)}**`);
        if (build > 0)
          lines.push(`- ${pct}% off the build fee: ${priceLine(off(build, pct), monthly, { yearly })}`);
        if (monthly > 0)
          lines.push(`- ${pct}% off the monthly fee: ${priceLine(build, off(monthly, pct), { yearly })}`);
      }
      blocks.push(lines.join("\n"));
    }
  }
  return blocks.join("\n\n");
}

export function renderNextSteps(p, lead) {
  return fillTemplate(p.next_steps, {
    tier: tierLabel(p.line_items),
    first_name: firstName(lead),
    company: lead?.company || "",
    percent: Number(p.discount_percent ?? 50),
  }).trim();
}

// Fill an email layout. The layout is blank-line-separated chunks; a chunk
// that is only a **Heading** is dropped when the placeholder chunk right
// after it renders empty, so an unused section takes its heading with it.
//
// MIRRORED in frontend/src/emailFormat.js (live preview). Keep in sync.
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

// Everything except the model-written sections, ready to merge with a
// version's prose.
export function fixedParts(p, lead) {
  return {
    pricing: renderPricing(p),
    pricing_note: p.pricing_note || "",
    next_steps: renderNextSteps(p, lead),
    signature: p.signature || "",
    first_name: firstName(lead),
    company: lead?.company || "",
  };
}

// The full email body as it goes out.
export function assembleEmail(p, lead, version) {
  return renderLayout(p.layout, {
    ...fixedParts(p, lead),
    intro: version?.intro || "",
    scope: version?.scope || "",
    questions: version?.questions || "",
    closing: version?.closing || "",
  });
}

// Validate/normalise line items coming from the client. Prices are what the
// proposal quotes, so they're stored as plain numbers, never strings.
export function cleanLineItems(raw) {
  if (!Array.isArray(raw)) {
    const err = new Error("line_items must be an array.");
    err.status = 422;
    throw err;
  }
  return raw.map((i, idx) => {
    const name = String(i?.name || "").trim();
    if (!name) {
      const err = new Error(`Line item ${idx + 1} needs a name.`);
      err.status = 422;
      throw err;
    }
    const num = (v) => {
      const n = Number(v || 0);
      if (!Number.isFinite(n) || n < 0) {
        const err = new Error(`Line item "${name}" has an invalid price.`);
        err.status = 422;
        throw err;
      }
      return Math.round(n * 100) / 100;
    };
    return {
      offering_id: i.offering_id || null,
      name,
      tagline: String(i.tagline || "").trim(),
      features: Array.isArray(i.features)
        ? i.features.map((f) => String(f).trim()).filter(Boolean)
        : [],
      build_fee: num(i.build_fee),
      monthly_fee: num(i.monthly_fee),
      discount_eligible: i.discount_eligible !== false,
    };
  });
}
