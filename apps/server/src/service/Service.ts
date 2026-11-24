import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir, userInfo } from "node:os";
import { join } from "node:path";

import { runtimePaths } from "../paths.ts";

const SYSTEMD_UNIT = "clots.service";
const LAUNCHD_LABEL = "foo.clots.server";

/** The command that the background service runs: this checkout or installation in `serve` mode. */
const { serveCommand } = runtimePaths;

/**
 * The variables that the service keeps from the shell that ran `clots up`. A service gets a
 * minimal PATH, but the bots need `claude`, `node` and a browser.
 */
const serviceEnvironment = (): Record<string, string> => ({
  PATH: process.env.PATH ?? "",
  ...(process.env.CLOTS_HOME === undefined ? {} : { CLOTS_HOME: process.env.CLOTS_HOME }),
  ...(process.env.CLOTS_PORT === undefined ? {} : { CLOTS_PORT: process.env.CLOTS_PORT }),
  ...(process.env.CLOTS_TAILNET === undefined ? {} : { CLOTS_TAILNET: process.env.CLOTS_TAILNET }),
  ...(process.env.CLAUDE_CONFIG_DIR === undefined ? {} : { CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR }),
});

const run = (command: ReadonlyArray<string>) => Bun.spawnSync([...command], { stdout: "pipe", stderr: "pipe" });

export const systemdUnit = (command: ReadonlyArray<string>, environment: Record<string, string>) =>
  [
    "[Unit]",
    "Description=clots server",
    "After=network-online.target",
    "",
    "[Service]",
    `ExecStart=${command.join(" ")}`,
    ...Object.entries(environment).map(([name, value]) => `Environment="${name}=${value}"`),
    "Restart=always",
    "RestartSec=3",
    "",
    "[Install]",
    "WantedBy=default.target",
    "",
  ].join("\n");

const escapeXml = (value: string) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;");

export const launchdPlist = (command: ReadonlyArray<string>, environment: Record<string, string>) =>
  [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0"><dict>',
    `<key>Label</key><string>${LAUNCHD_LABEL}</string>`,
    `<key>ProgramArguments</key><array>${command.map((part) => `<string>${escapeXml(part)}</string>`).join("")}</array>`,
    `<key>EnvironmentVariables</key><dict>${Object.entries(environment)
      .map(([name, value]) => `<key>${name}</key><string>${escapeXml(value)}</string>`)
      .join("")}</dict>`,
    "<key>RunAtLoad</key><true/>",
    "<key>KeepAlive</key><true/>",
    "</dict></plist>",
    "",
  ].join("\n");

/** Installs the background service and starts it. A second call restarts it with the new settings. */
export const installService = (): void => {
  if (process.platform === "darwin") {
    const directory = join(homedir(), "Library/LaunchAgents");
    const plistPath = join(directory, `${LAUNCHD_LABEL}.plist`);
    const domain = `gui/${userInfo().uid}`;
    mkdirSync(directory, { recursive: true });
    writeFileSync(plistPath, launchdPlist(serveCommand, serviceEnvironment()));

    // `bootout` fails when the service is not loaded yet. That is the normal first run.
    run(["launchctl", "bootout", `${domain}/${LAUNCHD_LABEL}`]);
    run(["launchctl", "bootstrap", domain, plistPath]);

    return;
  }

  const directory = join(homedir(), ".config/systemd/user");
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, SYSTEMD_UNIT), systemdUnit(serveCommand, serviceEnvironment()));

  run(["systemctl", "--user", "daemon-reload"]);
  run(["systemctl", "--user", "enable", SYSTEMD_UNIT]);
  run(["systemctl", "--user", "restart", SYSTEMD_UNIT]);

  // Without linger, systemd stops the service when the operator logs out.
  run(["loginctl", "enable-linger", userInfo().username]);
};

/**
 * Stops the background service and keeps it installed. `clots up` starts it again, and so does
 * the next boot or login.
 */
export const stopService = (): void => {
  if (process.platform === "darwin") {
    run(["launchctl", "bootout", `gui/${userInfo().uid}/${LAUNCHD_LABEL}`]);

    return;
  }

  run(["systemctl", "--user", "stop", SYSTEMD_UNIT]);
};

/** Stops the background service and removes it, so that it does not start at the next boot or login. */
export const removeService = (): void => {
  if (process.platform === "darwin") {
    stopService();
    rmSync(join(homedir(), "Library/LaunchAgents", `${LAUNCHD_LABEL}.plist`), { force: true });

    return;
  }

  run(["systemctl", "--user", "disable", "--now", SYSTEMD_UNIT]);
  rmSync(join(homedir(), ".config/systemd/user", SYSTEMD_UNIT), { force: true });
  run(["systemctl", "--user", "daemon-reload"]);
};

/** Checks whether the background service runs. */
export const serviceIsRunning = (): boolean => {
  if (process.platform === "darwin") {
    return run(["launchctl", "print", `gui/${userInfo().uid}/${LAUNCHD_LABEL}`]).exitCode === 0;
  }

  return run(["systemctl", "--user", "is-active", "--quiet", SYSTEMD_UNIT]).exitCode === 0;
};
