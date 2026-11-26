import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import babel from "@rolldown/plugin-babel";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

/** The clots server that `vite dev` forwards the WebSocket paths to. */
const SERVER = "http://127.0.0.1:4587";

export default defineConfig({
  plugins: [
    tanstackRouter({ target: "react", autoCodeSplitting: true }),
    react(),
    babel({ presets: [reactCompilerPreset()] }),
    tailwindcss(),
  ],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  server: {
    /**
     * The server gives this port to the sidecar, so it must not move to another one.
     * `localhost` can mean IPv6 only. The sidecar and the server use the IPv4 loopback address.
     */
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    // The sidecar forwards requests for the tailnet address to Vite.
    allowedHosts: [".ts.net"],
    proxy: {
      "/rpc": { target: SERVER, ws: true },
      "/browser": { target: SERVER, ws: true },
      "/attachments": { target: SERVER },
    },
  },
});
