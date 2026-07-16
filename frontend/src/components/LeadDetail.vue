<script setup>
import { ref, onMounted, inject, computed } from "vue";
import { api } from "../api.js";

const props = defineProps({ leadId: { type: String, default: null } });
const emit = defineEmits(["back", "saved", "deleted"]);
const flash = inject("flash");
const config = inject("config");

const STATUSES = ["new", "contacted", "qualified", "proposal", "won", "lost"];
const PRIORITIES = ["low", "medium", "high"];

const isNew = computed(() => !props.leadId);
const form = ref(blank());
const followups = ref([]);
const busy = ref(false);
const generating = ref(false);
const reminding = ref(false);
const instructions = ref("");

function blank() {
  return {
    name: "",
    company: "",
    title: "",
    email: "",
    phone: "",
    relationship: "",
    business_needs: "",
    next_steps: "",
    status: "new",
    priority: "medium",
    source: "",
    estimated_value: "",
    last_contact_date: "",
    next_action_date: "",
    notes: "",
  };
}

function dateInput(d) {
  return d ? new Date(d).toISOString().slice(0, 10) : "";
}

async function load() {
  if (isNew.value) return;
  busy.value = true;
  try {
    const l = await api.getLead(props.leadId);
    followups.value = l.followups || [];
    form.value = {
      ...blank(),
      ...l,
      estimated_value: l.estimated_value ?? "",
      last_contact_date: dateInput(l.last_contact_date),
      next_action_date: dateInput(l.next_action_date),
    };
  } catch (e) {
    flash(e.message, true);
  } finally {
    busy.value = false;
  }
}

async function save() {
  if (!form.value.name.trim()) return flash("A name is required.", true);
  busy.value = true;
  try {
    if (isNew.value) await api.createLead(form.value);
    else await api.updateLead(props.leadId, form.value);
    flash("Saved.");
    emit("saved");
  } catch (e) {
    flash(e.message, true);
  } finally {
    busy.value = false;
  }
}

async function remove() {
  if (!confirm("Delete this lead? This can't be undone.")) return;
  try {
    await api.deleteLead(props.leadId);
    flash("Lead deleted.");
    emit("deleted");
  } catch (e) {
    flash(e.message, true);
  }
}

async function generate() {
  if (isNew.value) return flash("Save the lead first, then generate a follow-up.", true);
  generating.value = true;
  try {
    const r = await api.generateFollowup(props.leadId, instructions.value);
    followups.value = [r.followup, ...followups.value];
    instructions.value = "";
    flash(`Follow-up drafted by ${r.meta.worker} (${r.meta.elapsed_ms} ms).`);
  } catch (e) {
    flash(e.message, true);
  } finally {
    generating.value = false;
  }
}

async function remind() {
  if (isNew.value) return;
  reminding.value = true;
  try {
    await api.remindLead(props.leadId);
    flash("Reminder email sent.");
  } catch (e) {
    flash(e.message, true);
  } finally {
    reminding.value = false;
  }
}

async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
    flash("Copied to clipboard.");
  } catch {
    flash("Couldn't copy.", true);
  }
}

function fmtTs(t) {
  return new Date(t).toLocaleString();
}

onMounted(load);
</script>

<template>
  <div class="toolbar">
    <button class="ghost small" @click="emit('back')">← Back</button>
    <div class="spacer"></div>
    <button v-if="!isNew" class="danger small" @click="remove">Delete</button>
    <button class="primary" :disabled="busy" @click="save">
      {{ busy ? "…" : isNew ? "Create lead" : "Save changes" }}
    </button>
  </div>

  <div class="grid-detail">
    <!-- Left: the lead form -->
    <div class="card">
      <div class="section-title">Contact</div>
      <div class="row">
        <div class="field">
          <label>Name *</label>
          <input v-model="form.name" />
        </div>
        <div class="field">
          <label>Company</label>
          <input v-model="form.company" />
        </div>
      </div>
      <div class="row">
        <div class="field">
          <label>Title / role</label>
          <input v-model="form.title" />
        </div>
        <div class="field">
          <label>Source</label>
          <input v-model="form.source" placeholder="referral, event, inbound…" />
        </div>
      </div>
      <div class="row">
        <div class="field">
          <label>Email</label>
          <input v-model="form.email" type="email" />
        </div>
        <div class="field">
          <label>Phone</label>
          <input v-model="form.phone" />
        </div>
      </div>

      <div class="section-title" style="margin-top:8px;">Relationship & needs</div>
      <div class="field">
        <label>Relationship / how you know them</label>
        <textarea v-model="form.relationship" />
      </div>
      <div class="field">
        <label>Potential business needs</label>
        <textarea v-model="form.business_needs" />
      </div>
      <div class="field">
        <label>Next steps</label>
        <textarea v-model="form.next_steps" />
      </div>

      <div class="section-title" style="margin-top:8px;">Pipeline</div>
      <div class="row-3">
        <div class="field">
          <label>Status</label>
          <select v-model="form.status">
            <option v-for="s in STATUSES" :key="s" :value="s">{{ s }}</option>
          </select>
        </div>
        <div class="field">
          <label>Priority</label>
          <select v-model="form.priority">
            <option v-for="p in PRIORITIES" :key="p" :value="p">{{ p }}</option>
          </select>
        </div>
        <div class="field">
          <label>Est. value ($)</label>
          <input v-model="form.estimated_value" type="number" min="0" step="100" />
        </div>
      </div>
      <div class="row">
        <div class="field">
          <label>Last contact date</label>
          <input v-model="form.last_contact_date" type="date" />
        </div>
        <div class="field">
          <label>Next action date</label>
          <input v-model="form.next_action_date" type="date" />
        </div>
      </div>
      <div class="field">
        <label>Notes</label>
        <textarea v-model="form.notes" />
      </div>
    </div>

    <!-- Right: AI follow-ups + reminders -->
    <div>
      <div class="card" style="margin-bottom:20px;">
        <div class="section-title">Follow-up assistant</div>
        <p class="muted" style="margin-top:0; font-size:13px;">
          Generates a draft message from this lead's details via your dry-dock
          worker node.
        </p>
        <div class="field">
          <label>Extra instructions (optional)</label>
          <textarea
            v-model="instructions"
            placeholder="e.g. mention the demo we scheduled; keep it casual"
            style="min-height:56px;"
          />
        </div>
        <button
          class="primary"
          style="width:100%;"
          :disabled="generating || isNew || !config.drydock"
          @click="generate"
        >
          {{ generating ? "Generating…" : "✨ Generate follow-up" }}
        </button>
        <p v-if="!config.drydock" class="muted" style="font-size:12px;">
          dry-dock isn't configured on the server.
        </p>
        <p v-if="isNew" class="muted" style="font-size:12px;">
          Save the lead first to enable generation.
        </p>

        <button
          class="ghost small"
          style="width:100%; margin-top:12px;"
          :disabled="reminding || isNew || !config.resend"
          @click="remind"
        >
          {{ reminding ? "Sending…" : "✉️ Email me a reminder" }}
        </button>
        <p v-if="!config.resend" class="muted" style="font-size:12px;">
          Resend isn't configured on the server.
        </p>
      </div>

      <div class="card" v-if="followups.length">
        <div class="section-title">Drafts ({{ followups.length }})</div>
        <div v-for="f in followups" :key="f.id" class="followup">
          {{ f.content }}
          <div class="meta">
            {{ fmtTs(f.created_at) }}
            <span v-if="f.model"> · {{ f.model }}</span>
            <span v-if="f.worker"> · {{ f.worker }}</span>
            &nbsp;·&nbsp;
            <a href="#" @click.prevent="copy(f.content)">copy</a>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
