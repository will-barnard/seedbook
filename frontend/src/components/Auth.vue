<script setup>
import { ref } from "vue";
import { api } from "../api.js";

const props = defineProps({ needsSetup: Boolean });
const emit = defineEmits(["authed", "error"]);

const email = ref("");
const password = ref("");
const busy = ref(false);

async function submit() {
  busy.value = true;
  try {
    if (props.needsSetup) await api.setup(email.value, password.value);
    else await api.login(email.value, password.value);
    emit("authed");
  } catch (e) {
    emit("error", e.message);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="center-screen">
    <div class="card auth-card">
      <div class="brand" style="margin-bottom: 18px;">
        <span class="seed" style="font-size:22px;">🌱</span>
        <h1 style="margin:0;">Seedbook</h1>
      </div>
      <p class="muted" style="margin-top:0;">
        {{ needsSetup
          ? "Create the first account — it becomes the admin."
          : "Sign in to your lead tracker." }}
      </p>
      <form @submit.prevent="submit">
        <div class="field">
          <label>Email</label>
          <input v-model="email" type="email" autocomplete="username" required />
        </div>
        <div class="field">
          <label>Password{{ needsSetup ? " (8+ characters)" : "" }}</label>
          <input
            v-model="password"
            type="password"
            :autocomplete="needsSetup ? 'new-password' : 'current-password'"
            required
          />
        </div>
        <button class="primary" type="submit" :disabled="busy" style="width:100%;">
          {{ busy ? "…" : needsSetup ? "Create admin account" : "Sign in" }}
        </button>
      </form>
    </div>
  </div>
</template>
