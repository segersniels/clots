import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

/** Builds the desktop app's setup page into the app. The app loads it from disk, so every path is relative. */
export default defineConfig({
  base: "./",
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  build: {
    outDir: fileURLToPath(new URL("../desktop/resources/setup", import.meta.url)),
    emptyOutDir: true,
    rolldownOptions: { input: fileURLToPath(new URL("./setup.html", import.meta.url)) },
  },
});
