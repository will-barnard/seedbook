<script setup>
import { ref, onMounted, provide } from "vue";
import { api } from "./api.js";
import Auth from "./components/Auth.vue";
import LeadList from "./components/LeadList.vue";
import LeadDetail from "./components/LeadDetail.vue";
import ProposalEditor from "./components/ProposalEditor.vue";
import ProposalLog from "./components/ProposalLog.vue";
import ProposalSettings from "./components/ProposalSettings.vue";

const ready = ref(false);
const authed = ref(false);
const needsSetup = ref(false);
const config = ref({ drydock: false, resend: false });

// Simple view state: "list" | "detail" | "new" | "proposals" | "proposal" | "settings".
// (Still no vue-router — six views is about where it starts to earn its keep.)
const view = ref("list");
const activeId = ref(null);
const activeProposalId = ref(null);
const toast = ref(null);

function flash(msg, isError = false) {
  toast.value = { msg, isError };
  setTimeout(() => (toast.value = null), 3200);
}
provide("flash", flash);
provide("config", config);

async function refreshAuth() {
  const s = await api.authStatus();
  needsSetup.value = s.needsSetup;
  authed.value = s.authenticated;
  if (authed.value) {
    config.value = await api.config();
  }
}

onMounted(async () => {
  try {
    await refreshAuth();
  } catch (e) {
    flash(e.message, true);
  } finally {
    ready.value = true;
  }
});

async function onAuthed() {
  await refreshAuth();
  view.value = "list";
}

async function logout() {
  await api.logout();
  authed.value = false;
  view.value = "list";
}

function openLead(id) {
  activeId.value = id;
  view.value = "detail";
}
function newLead() {
  activeId.value = null;
  view.value = "new";
}
function backToList() {
  view.value = "list";
  activeId.value = null;
}
function openProposal(id) {
  activeProposalId.value = id;
  view.value = "proposal";
}
function go(v) {
  view.value = v;
  activeProposalId.value = null;
}

async function runDigest() {
  try {
    const r = await api.runDigest();
    if (r.skipped) flash("Resend not configured on the server.", true);
    else if (r.sent) flash(`Digest sent for ${r.count} lead(s).`);
    else flash("No leads are due right now.");
  } catch (e) {
    flash(e.message, true);
  }
}
</script>

<template>
  <div v-if="!ready" class="center-screen muted">Loading…</div>

  <Auth
    v-else-if="!authed"
    :needs-setup="needsSetup"
    @authed="onAuthed"
    @error="(m) => flash(m, true)"
  />

  <template v-else>
    <header class="topbar">
      <div class="brand">
        <span class="seed">🌱</span>
        <h1>Seedbook</h1>
        <nav class="nav">
          <button class="ghost small" :class="{ on: ['list', 'detail', 'new'].includes(view) }" @click="backToList">Leads</button>
          <button class="ghost small" :class="{ on: ['proposals', 'proposal'].includes(view) }" @click="go('proposals')">Proposals</button>
          <button class="ghost small" :class="{ on: view === 'settings' }" @click="go('settings')">Rate card</button>
        </nav>
      </div>
      <div style="display:flex; gap:10px;">
        <button class="ghost small" @click="runDigest" title="Send the due-leads digest now">
          Send digest now
        </button>
        <button class="ghost small" @click="logout">Log out</button>
      </div>
    </header>

    <div class="wrap">
      <LeadList
        v-if="view === 'list'"
        @open="openLead"
        @new="newLead"
      />
      <LeadDetail
        v-else-if="view === 'detail' || view === 'new'"
        :key="view + (activeId || '')"
        :lead-id="view === 'new' ? null : activeId"
        @back="backToList"
        @saved="backToList"
        @deleted="backToList"
        @proposal="openProposal"
      />
      <ProposalLog v-else-if="view === 'proposals'" @open="openProposal" />
      <ProposalEditor
        v-else-if="view === 'proposal'"
        :key="activeProposalId"
        :proposal-id="activeProposalId"
        @back="openLead"
        @deleted="openLead"
      />
      <ProposalSettings v-else-if="view === 'settings'" />
    </div>
  </template>

  <div v-if="toast" class="toast" :class="{ err: toast.isError }">{{ toast.msg }}</div>
</template>
