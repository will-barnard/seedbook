<script setup>
import { ref, onMounted, inject } from "vue";
import { api } from "../api.js";

const emit = defineEmits(["open", "new"]);
const flash = inject("flash");

const leads = ref([]);
const q = ref("");
const status = ref("");
const loading = ref(true);

const STATUSES = ["new", "contacted", "qualified", "proposal", "won", "lost"];

async function load() {
  loading.value = true;
  try {
    leads.value = await api.listLeads({ q: q.value, status: status.value });
  } catch (e) {
    flash(e.message, true);
  } finally {
    loading.value = false;
  }
}

function fmtDate(d) {
  return d ? new Date(d).toISOString().slice(0, 10) : "—";
}
function isDue(d) {
  return d && new Date(d) <= new Date(new Date().toISOString().slice(0, 10));
}
function money(v) {
  return v == null ? "—" : "$" + Number(v).toLocaleString();
}

onMounted(load);
</script>

<template>
  <div class="toolbar">
    <input
      class="grow"
      v-model="q"
      @keyup.enter="load"
      placeholder="Search name or company…"
      style="max-width:320px;"
    />
    <select v-model="status" @change="load" style="width:auto;">
      <option value="">All statuses</option>
      <option v-for="s in STATUSES" :key="s" :value="s">{{ s }}</option>
    </select>
    <button class="small" @click="load">Search</button>
    <div class="spacer"></div>
    <button class="primary" @click="emit('new')">+ New lead</button>
  </div>

  <div class="card" style="padding:0; overflow:hidden;">
    <table>
      <thead>
        <tr>
          <th>Name</th>
          <th>Company</th>
          <th>Status</th>
          <th>Priority</th>
          <th>Next action</th>
          <th class="right">Est. value</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="l in leads" :key="l.id" @click="emit('open', l.id)">
          <td>{{ l.name }}</td>
          <td class="muted">{{ l.company || "—" }}</td>
          <td><span class="badge" :class="'st-' + l.status">{{ l.status }}</span></td>
          <td :class="'pri-' + l.priority">{{ l.priority }}</td>
          <td :class="{ due: isDue(l.next_action_date) }">{{ fmtDate(l.next_action_date) }}</td>
          <td class="right muted">{{ money(l.estimated_value) }}</td>
        </tr>
        <tr v-if="!loading && leads.length === 0">
          <td colspan="6" class="muted" style="text-align:center; padding:30px;">
            No leads yet. Click “New lead” to add your first.
          </td>
        </tr>
        <tr v-if="loading">
          <td colspan="6" class="muted" style="text-align:center; padding:30px;">Loading…</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
