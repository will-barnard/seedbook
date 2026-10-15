<script setup>
// Rate card + reusable proposal text. Template text reaches every draft
// that hasn't customised that part; sent proposals keep exactly what went
// out. Rate card PRICES are copied onto a proposal when an offering is
// picked, so a price change never alters a quote already in progress.
import { ref, onMounted, inject, computed } from "vue";
import { api } from "../api.js";

const flash = inject("flash");

const offerings = ref([]);
const settings = ref(null);
const savingSettings = ref(false);

function toForm(o) {
  return {
    ...o,
    build_fee: Number(o.build_fee),
    monthly_fee: Number(o.monthly_fee),
    featuresText: (o.features || []).join("\n"),
    _saved: JSON.stringify([o.name, o.tagline, Number(o.build_fee), Number(o.monthly_fee), (o.features || []).join("\n"), o.discount_eligible, o.active, o.sort_order]),
  };
}
function isDirty(o) {
  return (
    !o.id ||
    JSON.stringify([o.name, o.tagline, Number(o.build_fee), Number(o.monthly_fee), o.featuresText, o.discount_eligible, o.active, o.sort_order]) !== o._saved
  );
}

async function load() {
  try {
    const [offs, s] = await Promise.all([api.listOfferings(), api.getSettings()]);
    offerings.value = offs.map(toForm);
    settings.value = s;
  } catch (e) {
    flash(e.message, true);
  }
}

function payload(o) {
  return {
    name: o.name,
    tagline: o.tagline,
    features: o.featuresText,
    build_fee: o.build_fee,
    monthly_fee: o.monthly_fee,
    discount_eligible: o.discount_eligible,
    active: o.active,
    sort_order: o.sort_order,
  };
}

async function saveOffering(o, i) {
  try {
    const saved = o.id ? await api.updateOffering(o.id, payload(o)) : await api.createOffering(payload(o));
    offerings.value[i] = toForm(saved);
    flash(`${saved.name} saved.`);
  } catch (e) {
    flash(e.message, true);
  }
}

async function removeOffering(o, i) {
  if (o.id && !confirm(`Delete ${o.name}? Past proposals keep their own copy. Unticking "active" hides it instead.`)) return;
  try {
    if (o.id) await api.deleteOffering(o.id);
    offerings.value.splice(i, 1);
  } catch (e) {
    flash(e.message, true);
  }
}

function addOffering() {
  offerings.value.push({
    id: null,
    name: "",
    tagline: "",
    featuresText: "",
    build_fee: 0,
    monthly_fee: 0,
    discount_eligible: true,
    active: true,
    sort_order: offerings.value.length + 1,
  });
}

async function saveSettings() {
  savingSettings.value = true;
  try {
    const { _default_pool, ...rest } = settings.value;
    settings.value = await api.updateSettings(rest);
    flash("Settings saved. New proposals will use them.");
  } catch (e) {
    flash(e.message, true);
  } finally {
    savingSettings.value = false;
  }
}

const poolHint = computed(() =>
  settings.value ? `Blank = ${settings.value._default_pool} (DRYDOCK_POOL). "auto" = any online worker.` : ""
);

onMounted(load);
</script>

<template>
  <div class="toolbar">
    <h2 class="page-title">Rate card &amp; proposal settings</h2>
  </div>

  <div class="card" style="margin-bottom:20px;">
    <div class="draft-head">
      <div class="section-title" style="margin:0;">Rate card</div>
      <div class="spacer"></div>
      <button class="small" @click="addOffering">+ Add offering</button>
    </div>
    <p class="hint">Yearly billing isn't quoted in proposals yet (it would be 10× monthly).</p>

    <div class="offering-grid">
      <div v-for="(o, i) in offerings" :key="o.id || 'new' + i" class="line-item" :class="{ inactive: !o.active }">
        <div class="field">
          <label>Name</label>
          <input v-model="o.name" placeholder="Professional" />
        </div>
        <div class="field">
          <label>Tagline</label>
          <input v-model="o.tagline" />
        </div>
        <div class="row">
          <div class="field">
            <label>Build fee ($)</label>
            <input v-model.number="o.build_fee" type="number" min="0" />
          </div>
          <div class="field">
            <label>Monthly ($)</label>
            <input v-model.number="o.monthly_fee" type="number" min="0" />
          </div>
        </div>
        <div class="field">
          <label>Includes (one per line)</label>
          <textarea v-model="o.featuresText" style="min-height:120px;" />
        </div>
        <label class="check"><input type="checkbox" v-model="o.discount_eligible" /> Discount offer can apply</label>
        <label class="check"><input type="checkbox" v-model="o.active" /> Active (shows in the picker)</label>
        <div class="row" style="align-items:end;">
          <div class="field" style="margin:0;">
            <label>Order</label>
            <input v-model.number="o.sort_order" type="number" />
          </div>
          <div style="display:flex; gap:8px; justify-content:flex-end;">
            <button class="danger small" @click="removeOffering(o, i)">Delete</button>
            <button class="primary small" :disabled="!isDirty(o)" @click="saveOffering(o, i)">Save</button>
          </div>
        </div>
      </div>
    </div>
  </div>

  <div class="card" v-if="settings">
    <div class="section-title">Proposal text</div>
    <div class="field">
      <label>About your business (context for the writer — not quoted to clients)</label>
      <textarea v-model="settings.business_summary" />
    </div>
    <div class="field">
      <label>Email layout</label>
      <textarea v-model="settings.email_layout" style="min-height:260px; font-family: ui-monospace, monospace; font-size:13px;" />
      <p class="hint">
        Written by dry-dock: <code v-pre>{{intro}}</code> <code v-pre>{{scope}}</code> <code v-pre>{{questions}}</code> <code v-pre>{{closing}}</code>.
        Yours, per proposal: <code v-pre>{{my_end}}</code> <code v-pre>{{next_steps}}</code> <code v-pre>{{signature}}</code>.
        A <code>**Heading**</code> on its own line is dropped when the section after it is empty.
        Changes here reach every draft right away; sent proposals keep exactly what went out.
      </p>
    </div>
    <div class="field">
      <label>Default “my end of things”</label>
      <textarea v-model="settings.my_end_template" style="min-height:150px;" />
      <p class="hint">
        Drafts follow this unless you've customised that proposal's copy. Price variables fill from the proposal's offerings:
        <code v-pre>{{build_fee}}</code> <code v-pre>{{monthly}}</code> <code v-pre>{{yearly}}</code> <code v-pre>{{tier}}</code>
        (first tier quoted), <code v-pre>{{features}}</code> (what the tier includes, as a list), <code v-pre>{{discount}}</code> (the 50% options, empty if not offered),
        <code v-pre>{{pricing}}</code> (every tier plus the discount), <code v-pre>{{prices}}</code> (every tier, no discount).
      </p>
    </div>
    <div class="field">
      <label>Default next steps</label>
      <textarea v-model="settings.next_steps_template" style="min-height:200px;" />
      <p class="hint">
        <code v-pre>{{tier}}</code> → “Professional tier” (or “Professional tier” or “Commerce tier”),
        <code v-pre>{{first_name}}</code>, <code v-pre>{{company}}</code>.
        Links as <code>[text](https://…)</code>, bold as <code>**text**</code>.
      </p>
    </div>
    <div class="row">
      <div class="field">
        <label>Discount (%)</label>
        <input v-model="settings.discount_percent" type="number" min="0" max="100" />
      </div>
      <div class="field">
        <label>Writing pool (dry-dock)</label>
        <input v-model="settings.proposal_pool" placeholder="blank / auto / planner…" />
        <p class="hint">{{ poolHint }}</p>
      </div>
    </div>
    <div class="field">
      <label>Discount wording</label>
      <textarea v-model="settings.discount_intro" style="min-height:56px;" />
      <p class="hint"><code v-pre>{{percent}}</code> fills with the discount. The two options are listed under it with the math done.</p>
    </div>
    <div class="field">
      <label>Signature</label>
      <textarea v-model="settings.signature" style="min-height:56px;" />
    </div>
    <div class="field">
      <label>Style guide — how you write (used in every draft)</label>
      <textarea
        v-model="settings.style_guide"
        style="min-height:140px;"
        placeholder="e.g. Short paragraphs. Open by referencing how we met. Never say 'leverage' or 'solutions'. Sound like a person, not an agency. Keep the whole email under 250 words before the pricing."
      />
      <p class="hint">Repeated feedback you give on drafts belongs here so you stop having to give it.</p>
    </div>
    <div class="field">
      <label>Example proposal — one you wrote yourself (used for voice only)</label>
      <textarea
        v-model="settings.example_proposal"
        style="min-height:200px;"
        placeholder="Paste a proposal email you've sent. Prices are stripped before the writer sees it, and it's told not to reuse the content."
      />
      <p class="hint">
        Swap in a newer one when you write a better one. A whole email costs roughly 1,000 tokens of the
        worker's context on every call.
      </p>
    </div>
    <button class="primary" :disabled="savingSettings" @click="saveSettings">
      {{ savingSettings ? "Saving…" : "Save settings" }}
    </button>
  </div>
</template>
