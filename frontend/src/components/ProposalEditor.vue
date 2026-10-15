<script setup>
// Proposal editor: setup (offerings, tone, directions) on the left; draft,
// feedback loop and email preview on the right.
//
// Pricing and next steps are rendered by the server from the saved setup —
// this component never does price math. Edit the setup, save, and the
// preview refreshes.
import { ref, computed, onMounted, inject } from "vue";
import { api } from "../api.js";
import { toHtml, toPlain, renderLayout, copyForEmail, lint } from "../emailFormat.js";

const props = defineProps({ proposalId: { type: String, required: true } });
const emit = defineEmits(["back", "deleted"]);
const flash = inject("flash");
const config = inject("config");

const SECTIONS = [
  { key: "subject", label: "Subject" },
  { key: "intro", label: "Intro" },
  { key: "scope", label: "The website (scope)", rows: "150px" },
  { key: "questions", label: "Questions for them", hint: "Leave empty and the heading drops out too." },
  { key: "closing", label: "Closing", rows: "56px" },
];

const data = ref(null); // { proposal, lead, versions, rendered, tones }
const offerings = ref([]);
const setup = ref(null);
const savedSetup = ref(""); // JSON of the setup as last saved
const setupDirty = computed(() => setup.value && JSON.stringify(setup.value) !== savedSetup.value);
const draft = ref(blankDraft());
const selectedVersionId = ref(null);
const feedback = ref("");
const sectionOpen = ref(null);
const sectionFeedback = ref("");
const working = ref(""); // "", "save", "generate", "revise", "revise:<section>", "send"
const lastWarnings = ref([]);
const outcomeNote = ref("");
const showNextSteps = ref(false);

function blankDraft() {
  return Object.fromEntries(SECTIONS.map((s) => [s.key, ""]));
}

const p = computed(() => data.value?.proposal);
const versions = computed(() => data.value?.versions || []);
const selectedVersion = computed(() => versions.value.find((v) => v.id === selectedVersionId.value));
const draftDirty = computed(() => {
  const v = selectedVersion.value;
  if (!v) return SECTIONS.some((s) => draft.value[s.key]);
  return SECTIONS.some((s) => (draft.value[s.key] || "") !== (v[s.key] || ""));
});
const hasDraft = computed(() => SECTIONS.some((s) => draft.value[s.key]?.trim()));
// Server-rendered fixed parts (pricing, next steps, signature…) plus the
// draft's prose, poured into the proposal's layout.
const preview = computed(() =>
  data.value ? renderLayout(p.value.layout, { ...data.value.rendered, ...draft.value }) : ""
);
const previewHtml = computed(() => toHtml(preview.value));
const warnings = computed(() => [...lastWarnings.value, ...lint(draft.value)]);
const busy = computed(() => Boolean(working.value));

function setupFrom(prop) {
  return {
    tone: prop.tone,
    approach_notes: prop.approach_notes || "",
    extra_details: prop.extra_details || "",
    line_items: JSON.parse(JSON.stringify(prop.line_items || [])),
    offer_discount: prop.offer_discount,
    show_features: prop.show_features,
    show_yearly: prop.show_yearly,
    pricing_note: prop.pricing_note || "",
    discount_percent: Number(prop.discount_percent),
    next_steps: prop.next_steps || "",
  };
}

function apply(view, { keepDraft = false } = {}) {
  data.value = view;
  setup.value = setupFrom(view.proposal);
  savedSetup.value = JSON.stringify(setup.value);
  if (!keepDraft) {
    const latest = view.versions[0];
    selectVersion(latest?.id || null, { force: true });
  }
}

function onPickVersion(ev) {
  if (draftDirty.value && !confirm("Discard your unsaved edits to this draft?")) {
    ev.target.value = selectedVersionId.value; // put the dropdown back
    return;
  }
  selectVersion(ev.target.value, { force: true });
}

function selectVersion(id, { force = false } = {}) {
  if (!force && draftDirty.value && !confirm("Discard your unsaved edits to this draft?")) return;
  selectedVersionId.value = id;
  const v = versions.value.find((x) => x.id === id);
  draft.value = v ? Object.fromEntries(SECTIONS.map((s) => [s.key, v[s.key] || ""])) : blankDraft();
}

async function load() {
  try {
    const [view, offs] = await Promise.all([api.getProposal(props.proposalId), api.listOfferings(true)]);
    offerings.value = offs;
    apply(view);
  } catch (e) {
    flash(e.message, true);
  }
}

// ── Setup ──────────────────────────────────────────────────

function isPicked(o) {
  return setup.value.line_items.some((i) => i.offering_id === o.id);
}
function togglePick(o) {
  const items = setup.value.line_items;
  const idx = items.findIndex((i) => i.offering_id === o.id);
  if (idx >= 0) items.splice(idx, 1);
  else
    items.push({
      offering_id: o.id,
      name: o.name,
      tagline: o.tagline || "",
      features: [...(o.features || [])],
      build_fee: Number(o.build_fee),
      monthly_fee: Number(o.monthly_fee),
      discount_eligible: o.discount_eligible,
    });
}
function addCustom() {
  setup.value.line_items.push({
    offering_id: null,
    name: "",
    tagline: "",
    features: [],
    build_fee: 0,
    monthly_fee: 0,
    discount_eligible: true,
  });
}
function rateCardFor(item) {
  return offerings.value.find((o) => o.id === item.offering_id);
}
function differsFromCard(item) {
  const o = rateCardFor(item);
  return o && (Number(o.build_fee) !== Number(item.build_fee) || Number(o.monthly_fee) !== Number(item.monthly_fee));
}

async function saveSetup({ quiet = false } = {}) {
  working.value = "save";
  try {
    const view = await api.updateProposal(props.proposalId, setup.value);
    apply(view, { keepDraft: true });
    if (!quiet) flash("Setup saved.");
    return true;
  } catch (e) {
    flash(e.message, true);
    return false;
  } finally {
    working.value = "";
  }
}

// ── Writing ────────────────────────────────────────────────

async function afterWrite(r, label) {
  lastWarnings.value = r.warnings || [];
  const view = await api.getProposal(props.proposalId);
  apply(view, { keepDraft: true });
  selectVersion(r.version.id, { force: true });
  flash(`${label} by ${r.meta?.worker || "dry-dock"}${r.meta?.elapsed_ms ? ` (${(r.meta.elapsed_ms / 1000).toFixed(1)}s)` : ""}.`);
}

async function generate() {
  if (versions.value.length && !confirm("Write a fresh draft from scratch? Earlier versions stay in the history.")) return;
  if (setupDirty.value && !(await saveSetup({ quiet: true }))) return;
  working.value = "generate";
  try {
    await afterWrite(await api.generateProposal(props.proposalId), "Drafted");
  } catch (e) {
    flash(e.message, true);
  } finally {
    working.value = "";
  }
}

async function revise(section = null) {
  const fb = (section ? sectionFeedback.value : feedback.value).trim();
  if (!fb) return flash("Say what to change first.", true);
  if (setupDirty.value && !(await saveSetup({ quiet: true }))) return;
  working.value = section ? `revise:${section}` : "revise";
  try {
    // Send what's on screen, hand edits included, as the base.
    const r = await api.reviseProposal(props.proposalId, { feedback: fb, section, base: { ...draft.value } });
    await afterWrite(r, section ? `Rewrote the ${section}` : "Revised");
    if (section) {
      sectionFeedback.value = "";
      sectionOpen.value = null;
    } else feedback.value = "";
  } catch (e) {
    flash(e.message, true);
  } finally {
    working.value = "";
  }
}

async function saveEdits() {
  working.value = "save";
  try {
    const r = await api.saveProposalVersion(props.proposalId, { ...draft.value });
    const view = await api.getProposal(props.proposalId);
    apply(view, { keepDraft: true });
    selectVersion(r.version.id, { force: true });
    flash(`Saved as v${r.version.version}.`);
    return r.version;
  } catch (e) {
    flash(e.message, true);
    return null;
  } finally {
    working.value = "";
  }
}

// ── Copy + send ────────────────────────────────────────────

async function copyRich(md = preview.value) {
  try {
    await copyForEmail(md);
    flash("Copied — paste into your email.");
  } catch {
    flash("Couldn't copy.", true);
  }
}
async function copyText(text, msg = "Copied.") {
  try {
    await navigator.clipboard.writeText(text);
    flash(msg);
  } catch {
    flash("Couldn't copy.", true);
  }
}

async function markSent() {
  if (setupDirty.value) return flash("Save the setup first so the pricing matches what you copied.", true);
  let versionId = selectedVersionId.value;
  if (draftDirty.value) {
    const v = await saveEdits();
    if (!v) return;
    versionId = v.id;
  }
  if (!versionId) return flash("There's no draft to send yet.", true);
  working.value = "send";
  try {
    apply(await api.sendProposal(props.proposalId, versionId), { keepDraft: true });
    flash("Logged as sent. The lead moved to the proposal stage.");
  } catch (e) {
    flash(e.message, true);
  } finally {
    working.value = "";
  }
}

async function setOutcome(status) {
  try {
    apply(await api.proposalOutcome(props.proposalId, status, outcomeNote.value || null), { keepDraft: true });
    outcomeNote.value = "";
    flash(status === "sent" ? "Reopened." : `Marked ${status}.`);
  } catch (e) {
    flash(e.message, true);
  }
}

async function remove() {
  if (!confirm("Delete this proposal and all its versions?")) return;
  try {
    await api.deleteProposal(props.proposalId);
    flash("Proposal deleted.");
    emit("deleted", p.value.lead_id);
  } catch (e) {
    flash(e.message, true);
  }
}

function versionLabel(v) {
  const when = new Date(v.created_at).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  const src = v.source === "generate" ? "draft" : v.source === "manual" ? "your edits" : v.source.replace("revise:", "rewrote ").replace(/^revise$/, "revised");
  return `v${v.version} · ${src} · ${when}`;
}
function fmtDate(d) {
  return d ? new Date(d).toLocaleString() : "";
}

onMounted(load);
</script>

<template>
  <div v-if="!data || !setup" class="muted" style="padding:40px; text-align:center;">Loading…</div>

  <template v-else>
    <div class="toolbar">
      <button class="ghost small" @click="emit('back', p.lead_id)">← {{ data.lead.name }}</button>
      <h2 class="page-title">
        Proposal<span class="muted" v-if="data.lead.company"> · {{ data.lead.company }}</span>
      </h2>
      <span class="badge" :class="'pst-' + p.status">{{ p.status }}</span>
      <div class="spacer"></div>
      <button class="danger small" @click="remove">Delete</button>
    </div>

    <!-- Outcome bar once it's gone out -->
    <div v-if="p.status !== 'draft'" class="card outcome-bar">
      <div>
        <strong>Sent</strong> <span class="muted">{{ fmtDate(p.sent_at) }}</span>
        <span v-if="p.outcome_note" class="muted"> · {{ p.outcome_note }}</span>
      </div>
      <div class="spacer"></div>
      <input v-model="outcomeNote" placeholder="Outcome note (which option they picked, why they passed…)" style="max-width:340px;" />
      <button v-if="p.status !== 'won'" class="small" @click="setOutcome('won')">Won</button>
      <button v-if="p.status !== 'lost'" class="small" @click="setOutcome('lost')">Lost</button>
      <button v-if="p.status !== 'sent'" class="ghost small" @click="setOutcome('sent')">Reopen</button>
    </div>

    <div class="proposal-grid">
      <!-- ── Setup ───────────────────────────────────── -->
      <div class="card">
        <div class="section-title">What you're offering</div>
        <div class="offer-picker">
          <label v-for="o in offerings" :key="o.id" class="offer-chip" :class="{ on: isPicked(o) }">
            <input type="checkbox" :checked="isPicked(o)" @change="togglePick(o)" />
            <span>{{ o.name }}</span>
            <span class="muted">${{ Number(o.build_fee) }} + ${{ Number(o.monthly_fee) }}/mo</span>
          </label>
        </div>

        <div v-for="(item, i) in setup.line_items" :key="i" class="line-item">
          <div class="line-item-head">
            <input v-if="!item.offering_id" v-model="item.name" placeholder="Custom item name" />
            <strong v-else>{{ item.name }} tier</strong>
            <button class="ghost small" @click="setup.line_items.splice(i, 1)" title="Remove">✕</button>
          </div>
          <input v-if="!item.offering_id" v-model="item.tagline" placeholder="One-line description" style="margin-bottom:8px;" />
          <div class="row">
            <div class="field">
              <label>Build fee ($)</label>
              <input v-model.number="item.build_fee" type="number" min="0" step="1" />
            </div>
            <div class="field">
              <label>Monthly ($)</label>
              <input v-model.number="item.monthly_fee" type="number" min="0" step="1" />
            </div>
          </div>
          <p v-if="differsFromCard(item)" class="hint">
            Rate card is ${{ Number(rateCardFor(item).build_fee) }} + ${{ Number(rateCardFor(item).monthly_fee) }}/mo — this proposal quotes its own price.
          </p>
          <div v-if="!item.offering_id" class="field">
            <label>Includes (one per line)</label>
            <textarea
              :value="item.features.join('\n')"
              @input="item.features = $event.target.value.split('\n')"
              style="min-height:56px;"
            />
          </div>
        </div>
        <button class="ghost small" @click="addCustom">+ Custom line item</button>

        <label class="check" style="margin-top:16px;">
          <input type="checkbox" v-model="setup.offer_discount" />
          Offer {{ setup.discount_percent }}% off — client's choice of build fee or monthly fee
        </label>
        <label class="check">
          <input type="checkbox" v-model="setup.show_yearly" />
          Show yearly price too (10× monthly)
        </label>
        <label class="check">
          <input type="checkbox" v-model="setup.show_features" />
          List what each tier includes
        </label>
        <div class="field" style="margin-top:10px;">
          <label>Pricing note — your words, added after the prices as-is</label>
          <textarea
            v-model="setup.pricing_note"
            style="min-height:56px;"
            placeholder="e.g. The shop integrations would normally push this to the Commerce tier — that's the discount I'm happy to give here."
          />
        </div>

        <div class="section-title" style="margin-top:18px;">Your direction</div>
        <div class="field">
          <label>Tone</label>
          <div class="seg">
            <button
              v-for="t in data.tones"
              :key="t"
              :class="{ on: setup.tone === t }"
              @click="setup.tone = t"
              type="button"
            >{{ t }}</button>
          </div>
        </div>
        <div class="field">
          <label>Your notes — what was agreed, open questions, context</label>
          <textarea
            v-model="setup.extra_details"
            style="min-height:140px;"
            placeholder="Scope from the call (accounts, admin CMS, unlisted YouTube videos + PDFs, courses sold individually, no subscription in v1…). Open questions (who handles shipping? domain picked? course prices? who owns Stripe?)…"
          />
        </div>
        <div class="field">
          <label>Directions — how to pitch it</label>
          <textarea v-model="setup.approach_notes" style="min-height:56px;" placeholder="e.g. two guys, greet them both; apologise for the slow follow-up; Evan cares about the visual style" />
        </div>
        <p class="hint">
          Also uses the lead's relationship, needs and notes:
          <em>{{ data.lead.business_needs || "no needs filled in on the lead yet" }}</em>
        </p>

        <div class="field">
          <a href="#" @click.prevent="showNextSteps = !showNextSteps" class="small-link">
            {{ showNextSteps ? "Hide" : "Edit" }} next steps for this proposal
          </a>
          <textarea v-if="showNextSteps" v-model="setup.next_steps" style="min-height:180px; margin-top:8px;" />
          <p v-if="showNextSteps" class="hint">
            <code v-pre>{{tier}}</code> fills with the tier name(s), <code v-pre>{{first_name}}</code> with theirs. Change the default in Rate card &amp; settings.
          </p>
        </div>

        <button class="primary" style="width:100%;" :disabled="busy || !setupDirty" @click="saveSetup()">
          {{ working === "save" ? "Saving…" : setupDirty ? "Save setup" : "Setup saved" }}
        </button>
      </div>

      <!-- ── Draft ───────────────────────────────────── -->
      <div>
        <div class="card" style="margin-bottom:20px;">
          <div class="draft-head">
            <div class="section-title" style="margin:0;">Draft</div>
            <div class="spacer"></div>
            <select v-if="versions.length" :value="selectedVersionId" @change="onPickVersion" style="width:auto; max-width:300px;">
              <option v-for="v in versions" :key="v.id" :value="v.id">{{ versionLabel(v) }}</option>
            </select>
          </div>
          <p v-if="selectedVersion?.feedback" class="hint">Feedback that produced this version: “{{ selectedVersion.feedback }}”</p>

          <button
            class="primary"
            style="width:100%; margin:12px 0;"
            :disabled="busy || !config.drydock || !setup.line_items.length"
            @click="generate"
          >
            {{ working === "generate" ? "Writing… (local models can take a minute or two)" : versions.length ? "Start over with a fresh draft" : "✨ Write first draft" }}
          </button>
          <p v-if="!config.drydock" class="hint">dry-dock isn't configured on the server.</p>
          <p v-else-if="!setup.line_items.length" class="hint">Pick at least one offering first.</p>

          <template v-if="hasDraft || versions.length">
            <div v-for="s in SECTIONS" :key="s.key" class="field">
              <div class="section-row">
                <label style="margin:0;">{{ s.label }}</label>
                <a href="#" class="small-link" @click.prevent="sectionOpen = sectionOpen === s.key ? null : s.key; sectionFeedback = ''">
                  ↻ rewrite
                </a>
              </div>
              <input v-if="s.key === 'subject'" v-model="draft.subject" />
              <textarea v-else v-model="draft[s.key]" :style="{ minHeight: s.rows || '90px' }" />
              <p v-if="s.hint" class="hint" style="margin-bottom:0;">{{ s.hint }}</p>
              <div v-if="sectionOpen === s.key" class="section-revise">
                <input v-model="sectionFeedback" :placeholder="`What should change in the ${s.label.toLowerCase()}?`" @keyup.enter="revise(s.key)" />
                <button class="small" :disabled="busy || !config.drydock" @click="revise(s.key)">
                  {{ working === `revise:${s.key}` ? "Rewriting…" : "Rewrite" }}
                </button>
              </div>
              <!-- Show where the fixed blocks land (default layout: before the closing) -->
              <div v-if="s.key === 'questions'" class="fixed-block">
                “My end of things”, pricing and next steps go here, built from the setup.
                <span v-if="setupDirty" class="warn-inline">Save setup to refresh them.</span>
              </div>
            </div>

            <div class="field">
              <label>Feedback on the whole draft</label>
              <textarea v-model="feedback" placeholder="e.g. too formal; cut the second paragraph; mention I can migrate their existing gallery" style="min-height:56px;" />
            </div>
            <div style="display:flex; gap:10px;">
              <button class="primary" style="flex:1;" :disabled="busy || !config.drydock || !feedback.trim()" @click="revise()">
                {{ working === "revise" ? "Revising…" : "Revise with feedback" }}
              </button>
              <button :disabled="busy || !draftDirty" @click="saveEdits">Save my edits</button>
            </div>
          </template>

          <ul v-if="warnings.length" class="warn-list">
            <li v-for="(w, i) in warnings" :key="i">{{ w }}</li>
          </ul>
        </div>

        <div class="card" v-if="hasDraft">
          <div class="draft-head">
            <div class="section-title" style="margin:0;">Email preview</div>
            <div class="spacer"></div>
            <button class="small" @click="copyText(draft.subject, 'Subject copied.')">Copy subject</button>
            <button class="small primary" @click="copyRich()">Copy email</button>
            <button class="ghost small" @click="copyText(toPlain(preview), 'Plain text copied.')">Plain text</button>
          </div>
          <div class="email-subject"><span class="muted">Subject:</span> {{ draft.subject }}</div>
          <div class="email-preview" v-html="previewHtml"></div>
          <button
            v-if="p.status === 'draft'"
            class="primary"
            style="width:100%; margin-top:14px;"
            :disabled="busy"
            @click="markSent"
          >
            {{ working === "send" ? "Logging…" : "Mark as sent" }}
          </button>
          <p v-if="p.status === 'draft'" class="hint">
            Logs exactly this version and moves {{ data.lead.name }} to the proposal stage.
          </p>
        </div>

        <div class="card" v-if="p.sent_content" style="margin-top:20px;">
          <div class="draft-head">
            <div class="section-title" style="margin:0;">What was sent</div>
            <div class="spacer"></div>
            <button class="ghost small" @click="copyRich(p.sent_content)">Copy</button>
          </div>
          <div class="email-subject"><span class="muted">Subject:</span> {{ p.sent_subject }}</div>
          <div class="email-preview" v-html="toHtml(p.sent_content)"></div>
        </div>
      </div>
    </div>
  </template>
</template>
