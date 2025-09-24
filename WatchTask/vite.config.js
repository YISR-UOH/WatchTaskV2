import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: "/WatchTask/",
  build: {
    outDir: "dist",
    chunkSizeWarningLimit: 5 * 1024 * 1024,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
    exclude: ["node_modules", "**/node_modules/*"],
  },
});
