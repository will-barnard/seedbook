<script setup>
// Every proposal, newest activity first — the running log of what went out
// and how it landed.
import { ref, onMounted, inject, computed } from "vue";
import { api } from "../api.js";

const emit = defineEmits(["open"]);
const flash = inject("flash");

const rows = ref([]);
const status = ref("");
const loading = ref(true);
const STATUSES = ["draft", "sent", "won", "lost"];

async function load() {
  loading.value = true;
  try {
    rows.value = await api.listProposals({ status: status.value });
  } catch (e) {
    flash(e.message, true);
  } finally {
    loading.value = false;
  }
}

const winRate = computed(() => {
  const decided = rows.value.filter((r) => r.status === "won" || r.status === "lost");
  if (!decided.length || status.value) return null;
  const won = decided.filter((r) => r.status === "won").length;
  return `${won} of ${decided.length} decided proposals won`;
});

function items(r) {
  return (r.line_items || []).map((i) => i.name).join(" / ") || "—";
}
function fmtDate(d) {
  return d ? new Date(d).toISOString().slice(0, 10) : "—";
}

onMounted(load);
</script>

<template>
  <div class="toolbar">
    <h2 class="page-title">Proposals</h2>
    <select v-model="status" @change="load" style="width:auto;">
      <option value="">All</option>
      <option v-for="s in STATUSES" :key="s" :value="s">{{ s }}</option>
    </select>
    <div class="spacer"></div>
    <span v-if="winRate" class="muted" style="font-size:13px;">{{ winRate }}</span>
  </div>

  <div class="card" style="padding:0; overflow:hidden;">
    <table>
      <thead>
        <tr>
          <th>Client</th>
          <th>Offering</th>
          <th>Status</th>
          <th>Sent</th>
          <th>Outcome note</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="r in rows" :key="r.id" @click="emit('open', r.id)">
          <td>
            {{ r.lead_name }}
            <div class="muted" style="font-size:12px;" v-if="r.lead_company">{{ r.lead_company }}</div>
          </td>
          <td>{{ items(r) }}<span v-if="r.offer_discount" class="muted"> · discount</span></td>
          <td><span class="badge" :class="'pst-' + r.status">{{ r.status }}</span></td>
          <td class="muted">{{ fmtDate(r.sent_at) }}</td>
          <td class="muted">{{ r.outcome_note || "" }}</td>
        </tr>
        <tr v-if="!loading && rows.length === 0">
          <td colspan="5" class="muted" style="text-align:center; padding:30px;">
            No proposals yet. Open a lead and click “New proposal”.
          </td>
        </tr>
        <tr v-if="loading">
          <td colspan="5" class="muted" style="text-align:center; padding:30px;">Loading…</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
