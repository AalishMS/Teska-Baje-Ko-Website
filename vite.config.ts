import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  server: {
    host: "0.0.0.0",
    port: 5173,
    strictPort: true,
    watch: {
      awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 25 },
    },
  },
  build: { target: "es2022" },
});
