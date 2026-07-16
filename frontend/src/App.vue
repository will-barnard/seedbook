<script setup>
import { ref, onMounted, provide } from "vue";
import { api } from "./api.js";
import Auth from "./components/Auth.vue";
import LeadList from "./components/LeadList.vue";
import LeadDetail from "./components/LeadDetail.vue";

const ready = ref(false);
const authed = ref(false);
const needsSetup = ref(false);
const config = ref({ drydock: false, resend: false });

// Simple view state: "list" or a lead id, or "new".
const view = ref("list");
const activeId = ref(null);
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
        v-else
        :lead-id="view === 'new' ? null : activeId"
        @back="backToList"
        @saved="backToList"
        @deleted="backToList"
      />
    </div>
  </template>

  <div v-if="toast" class="toast" :class="{ err: toast.isError }">{{ toast.msg }}</div>
</template>
