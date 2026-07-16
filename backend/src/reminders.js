// Reminder emails via Resend.
//
//  - Daily digest: a node-cron job that finds leads whose next_action_date is
//    due today or overdue (and aren't already won/lost) and emails you a list.
//  - Manual: send a reminder for one specific lead on demand.
import cron from "node-cron";
import { pool } from "./db.js";
import { sendEmail, resendConfigured } from "./resend.js";

function fmtDate(d) {
  if (!d) return "—";
  return new Date(d).toISOString().slice(0, 10);
}

function leadLine(l) {
  const bits = [l.name, l.company].filter(Boolean).join(" @ ");
  const due = fmtDate(l.next_action_date);
  const next = l.next_steps ? ` — next: ${l.next_steps}` : "";
  return `• ${bits} (due ${due}, ${l.status})${next}`;
}

// Leads that need attention: action date today or earlier, not closed.
export async function dueLeads() {
  const { rows } = await pool.query(
    `SELECT * FROM leads
     WHERE next_action_date IS NOT NULL
       AND next_action_date <= CURRENT_DATE
       AND status NOT IN ('won', 'lost')
     ORDER BY next_action_date ASC, priority DESC`
  );
  return rows;
}

export async function sendDailyDigest() {
  if (!resendConfigured()) {
    console.warn("[reminders] Resend not configured; skipping daily digest.");
    return { skipped: true };
  }
  const leads = await dueLeads();
  if (leads.length === 0) {
    console.log("[reminders] No due leads today; no digest sent.");
    return { sent: false, count: 0 };
  }
  const lines = leads.map(leadLine).join("\n");
  const html =
    `<h2>Seedbook: ${leads.length} lead(s) need attention</h2><ul>` +
    leads
      .map(
        (l) =>
          `<li><strong>${escapeHtml(l.name)}</strong>` +
          `${l.company ? " @ " + escapeHtml(l.company) : ""} — ` +
          `due ${fmtDate(l.next_action_date)}, ${escapeHtml(l.status)}` +
          `${l.next_steps ? "<br><em>Next: " + escapeHtml(l.next_steps) + "</em>" : ""}` +
          `</li>`
      )
      .join("") +
    `</ul>`;
  await sendEmail({
    subject: `Seedbook: ${leads.length} lead${leads.length === 1 ? "" : "s"} to follow up`,
    text: `You have ${leads.length} lead(s) needing attention:\n\n${lines}`,
    html,
  });
  console.log(`[reminders] Daily digest sent for ${leads.length} lead(s).`);
  return { sent: true, count: leads.length };
}

export async function sendLeadReminder(lead) {
  const html =
    `<h2>Reminder: follow up with ${escapeHtml(lead.name)}</h2>` +
    `<p>${lead.company ? "<strong>" + escapeHtml(lead.company) + "</strong><br>" : ""}` +
    `Status: ${escapeHtml(lead.status)} · Priority: ${escapeHtml(lead.priority)}<br>` +
    `Next action date: ${fmtDate(lead.next_action_date)}</p>` +
    (lead.business_needs
      ? `<p><strong>Needs:</strong> ${escapeHtml(lead.business_needs)}</p>`
      : "") +
    (lead.next_steps
      ? `<p><strong>Next steps:</strong> ${escapeHtml(lead.next_steps)}</p>`
      : "");
  await sendEmail({
    subject: `Seedbook reminder: ${lead.name}${lead.company ? " @ " + lead.company : ""}`,
    text: `Follow up with ${lead.name}${lead.company ? " @ " + lead.company : ""}.\n` +
      `Status: ${lead.status}\nNext action: ${fmtDate(lead.next_action_date)}\n` +
      `${lead.next_steps ? "Next steps: " + lead.next_steps : ""}`,
    html,
  });
  return { sent: true };
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

// Schedule the daily digest. REMINDER_CRON overrides the default (9am daily).
export function scheduleReminders() {
  const expr = process.env.REMINDER_CRON || "0 9 * * *";
  const tz = process.env.REMINDER_TZ || "UTC";
  if (!cron.validate(expr)) {
    console.error(`[reminders] Invalid REMINDER_CRON "${expr}"; digest disabled.`);
    return;
  }
  cron.schedule(
    expr,
    () => {
      sendDailyDigest().catch((e) =>
        console.error("[reminders] digest failed:", e.message)
      );
    },
    { timezone: tz }
  );
  console.log(`[reminders] Daily digest scheduled: "${expr}" (${tz}).`);
}
