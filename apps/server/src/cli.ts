#!/usr/bin/env bun
import { BunRuntime } from "@effect/platform-bun";
import { Layer } from "effect";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { renderUnicodeCompact } from "uqr";

import { makeClaudeEnvironment } from "./bots/ClaudeEnvironment.ts";
import { ServerLayer } from "./server.ts";
import { installService, removeService, serviceIsRunning, stopService } from "./service/Service.ts";
import { readSidecarStatus, sidecarIsBuilt } from "./sidecar/Sidecar.ts";

const HOME = process.env.CLOTS_HOME ?? join(homedir(), ".clots");
const PORT = Number(process.env.CLOTS_PORT ?? 4587);

/** The wait for the sidecar after the service starts, and for the operator's Tailscale login. */
const TAILNET_TIMEOUT_MS = 10 * 60_000;

const printWithQr = (label: string, url: string) => {
  console.log(`\n${label}\n  ${url}\n`);
  console.log(renderUnicodeCompact(url, { border: 2 }));
};

interface ClaudeLogin {
  readonly loggedIn: boolean;
  readonly authMethod?: string;
  readonly subscriptionType?: string;
}

/** Asks Claude Code for its login. clots never reads the tokens itself. */
const readClaudeLogin = (): ClaudeLogin => {
  const result = Bun.spawnSync(["claude", "auth", "status"], { env: makeClaudeEnvironment(process.env) });

  try {
    return JSON.parse(result.stdout.toString());
  } catch {
    return { loggedIn: false };
  }
};

/** Makes sure that the host has a Claude subscription login. Starts `claude auth login` if not. */
const ensureClaudeLogin = (): boolean => {
  if (Bun.which("claude") === null) {
    console.log("✗ Claude Code is not installed. See https://code.claude.com/docs/en/setup");

    return false;
  }

  let login = readClaudeLogin();

  if (!login.loggedIn) {
    console.log("Claude is not logged in. Starting `claude auth login`…");
    Bun.spawnSync(["claude", "auth", "login"], {
      env: makeClaudeEnvironment(process.env),
      stdio: ["inherit", "inherit", "inherit"],
    });
    login = readClaudeLogin();
  }

  // clots supports the subscription login only.
  if (!login.loggedIn || login.authMethod !== "claude.ai") {
    console.log("✗ Claude has no subscription login. Run `claude auth login` and choose your Claude account.");

    return false;
  }

  console.log(`✓ Claude login (${login.subscriptionType ?? "subscription"})`);

  return true;
};

const up = async () => {
  if (!ensureClaudeLogin()) process.exit(1);

  if (!existsSync(join(import.meta.dir, "../../web/dist")) || !sidecarIsBuilt()) {
    console.log("✗ The web client or the sidecar is not built. Run `bun run build` in the clots checkout.");
    process.exit(1);
  }

  installService();
  console.log(`✓ Background service ${serviceIsRunning() ? "runs" : "is installed, but it does not run yet"}`);
  console.log(`✓ Local address: http://127.0.0.1:${PORT}`);

  let shownAuthUrl: string | undefined;
  let toldAboutHttps = false;
  const deadline = Date.now() + TAILNET_TIMEOUT_MS;

  while (Date.now() < deadline) {
    const status = readSidecarStatus(HOME);

    if (status?.state === "ready" && status.url !== undefined) {
      printWithQr("✓ clots is on your tailnet. Open this address on your phone:", status.url);

      return;
    }

    if (status?.state === "needs_login" && status.authUrl !== undefined && status.authUrl !== shownAuthUrl) {
      shownAuthUrl = status.authUrl;
      printWithQr("Log in to Tailscale to add clots to your tailnet:", status.authUrl);
    }

    if (status?.state === "needs_https" && !toldAboutHttps) {
      toldAboutHttps = true;
      console.log("\nEnable HTTPS certificates for your tailnet: https://login.tailscale.com/admin/dns");
    }

    await Bun.sleep(1000);
  }

  console.log("✗ clots did not reach the tailnet in time. Run `clots status` to see the state.");
  process.exit(1);
};

const status = async () => {
  const login = readClaudeLogin();
  const reachable = await fetch(`http://127.0.0.1:${PORT}/`).then(
    () => true,
    () => false,
  );
  const sidecar = readSidecarStatus(HOME);

  console.log(`Claude login:  ${login.loggedIn ? `yes (${login.subscriptionType ?? login.authMethod})` : "no"}`);
  console.log(`Service:       ${serviceIsRunning() ? "running" : "not running"}`);
  console.log(`Local server:  ${reachable ? `http://127.0.0.1:${PORT}` : "not reachable"}`);
  console.log(`Tailnet:       ${sidecar?.url ?? sidecar?.state ?? "sidecar has not started"}`);
};

const stop = (remove: boolean) => {
  if (remove) {
    removeService();
  } else {
    stopService();
  }

  if (serviceIsRunning()) {
    console.log("✗ The background service still runs.");
    process.exit(1);
  }

  console.log(`✓ Background service ${remove ? "removed" : "stopped"}. Run \`clots up\` to start it again.`);
};

const command = process.argv[2];

if (command === "serve") {
  BunRuntime.runMain(Layer.launch(ServerLayer));
} else if (command === "up") {
  await up();
} else if (command === "stop") {
  stop(process.argv.includes("--force"));
} else if (command === "status") {
  await status();
} else {
  console.log("Usage: clots <command>\n\n  up      Check the Claude login, install the background service, join the tailnet\n  stop    Stop the background service. With --force, also remove it\n  status  Show the state of the service and the tailnet\n  serve   Run the server in the foreground");
  process.exit(command === undefined ? 0 : 1);
}
