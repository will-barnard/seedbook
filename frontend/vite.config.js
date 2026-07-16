import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
  plugins: [vue()],
  server: {
    // Local dev: proxy API calls to the backend so cookies + relative paths
    // work the same as in production behind nginx.
    proxy: {
      "/api": "http://localhost:3001",
      "/healthz": "http://localhost:3001",
    },
  },
});
