/**
 * Builds the clots bundle for this machine: the `clots` binary and the files that it needs next to
 * it. `bun run build:cli` in the repository root runs this after it builds the web client and the
 * sidecar. Install the result with `dist/clots-<platform>/clots install`.
 */
import { $ } from "bun";
import { chmodSync, copyFileSync, cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// @ts-expect-error The package ships this helper as plain JavaScript without types.
import { findNativeBinary, nativeTarget } from "../node_modules/agent-browser/scripts/native.js";

const root = join(import.meta.dir, "../../..");
const bundle = join(root, "dist", `clots-${process.platform}-${process.arch}`);
const webClient = join(root, "apps/web/dist");
const sidecar = join(root, "apps/sidecar/clots-sidecar");
const agentBrowserPackage = join(import.meta.dir, "../node_modules/agent-browser");
const agentBrowser: string | null = findNativeBinary(agentBrowserPackage, nativeTarget());

for (const [name, path] of [
  ["web client", webClient],
  ["sidecar", sidecar],
] as const) {
  if (!existsSync(path)) throw new Error(`The ${name} is not built at ${path}. Run \`bun run build\` first.`);
}

if (agentBrowser === null) throw new Error("agent-browser has no native binary for this platform.");

rmSync(bundle, { recursive: true, force: true });
mkdirSync(join(bundle, "bin"), { recursive: true });
mkdirSync(join(bundle, "libexec"), { recursive: true });

await $`bun build --compile --minify ${join(import.meta.dir, "../src/cli.ts")} --outfile ${join(bundle, "clots")}`;
cpSync(webClient, join(bundle, "web"), { recursive: true });
copyFileSync(sidecar, join(bundle, "clots-sidecar"));
copyFileSync(agentBrowser, join(bundle, "libexec/agent-browser"));

// agent-browser finds `skill-data` in the parent of its binary's folder. Bots read these guides with `agent-browser skills get`.
cpSync(join(agentBrowserPackage, "skill-data"), join(bundle, "skill-data"), { recursive: true });

// A bot's PATH starts with `bin`, so each `agent-browser` command goes through clots, which starts the bot's Chrome first.
const wrapper = join(bundle, "bin/agent-browser");
writeFileSync(wrapper, '#!/bin/sh\nexec "$(dirname "$0")/../clots" agent-browser "$@"\n');
chmodSync(wrapper, 0o755);

console.log(`\n✓ Built ${bundle}\n  Install it with: ${join(bundle, "clots")} install`);
