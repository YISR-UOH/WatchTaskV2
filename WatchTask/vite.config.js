import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import { fileURLToPath } from "url";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: "/WatchTaskV2/",
  build: {
    outDir: "dist",
    chunkSizeWarningLimit: 5 * 1024 * 1024,
  },
  resolve: {
    alias: {
      "@": path.resolve(path.dirname(fileURLToPath(import.meta.url)), "./src"),
    },
    exclude: ["node_modules", "**/node_modules/*"],
  },
});
