import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

/** The clots server that `vite dev` forwards the WebSocket paths to. */
const SERVER = "http://127.0.0.1:4587";

export default defineConfig({
  plugins: [tanstackRouter({ target: "react", autoCodeSplitting: true }), react(), tailwindcss()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  server: {
    proxy: {
      "/rpc": { target: SERVER, ws: true },
      "/browser": { target: SERVER, ws: true },
    },
  },
});
