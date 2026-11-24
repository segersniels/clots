import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { runtimePaths } from "../paths.ts";

/** The HOME that clots gives `agent-browser install`, which downloads into `~/.agent-browser/browsers`. */
const TOOLS = join(process.env.CLOTS_HOME ?? join(homedir(), ".clots"), "tools");

/** The folder that holds one `chrome-<version>` folder for each Chrome for Testing that clots downloaded. */
const BROWSERS = join(TOOLS, ".agent-browser/browsers");

/** The Chrome executable inside a `chrome-<version>` folder on Linux and on macOS. */
const EXECUTABLES = ["chrome", "Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"];

/** The AppArmor profile that lets clots's own Chrome use its sandbox on Ubuntu 23.10 and later. */
const APPARMOR_PROFILE = "/etc/apparmor.d/clots-chrome";

/** Finds the newest Chrome for Testing that clots downloaded. */
export const installedBrowser = () => {
  const versions = existsSync(BROWSERS) ? readdirSync(BROWSERS).sort().reverse() : [];

  return versions
    .flatMap((version) => EXECUTABLES.map((executable) => join(BROWSERS, version, executable)))
    .find((path) => existsSync(path));
};

/**
 * Downloads Chrome for Testing into the clots home with `agent-browser install`. Returns the
 * executable, or `undefined` when the download failed, for example without a network.
 */
export const installBrowser = async () => {
  const install = Bun.spawn([runtimePaths.agentBrowser, "install"], {
    env: { ...process.env, HOME: TOOLS },
    stdout: "ignore",
    stderr: "ignore",
  });
  await install.exited;

  return installedBrowser();
};

/**
 * Lists what a Linux host must fix before `executable` can run, each with the command that fixes
 * it. clots cannot fix these itself, because each one needs root.
 */
export const browserHostProblems = (executable: string) => {
  if (process.platform !== "linux") return [];

  const problems: Array<{ problem: string; fix: string }> = [];
  const version = Bun.spawnSync([executable, "--version"], { stderr: "pipe" });
  const font = Bun.spawnSync(["fc-match", "--format=%{file}", "sans-serif"], { stderr: "ignore" });

  // agent-browser skips the download that it already made and installs the libraries and fonts with the package manager.
  if (version.stderr.toString().includes("error while loading shared libraries") || font.stdout.toString().trim() === "") {
    problems.push({
      problem: "The host lacks libraries or fonts that Chrome needs.",
      fix: `HOME=${TOOLS} ${runtimePaths.agentBrowser} install --with-deps`,
    });
  }

  if (executable.startsWith(BROWSERS) && usernsRestricted() && !existsSync(APPARMOR_PROFILE)) {
    const profile = [
      "abi <abi/4.0>,",
      "include <tunables/global>",
      `profile clots-chrome ${BROWSERS}/*/chrome flags=(unconfined) {`,
      "  userns,",
      "}",
    ];

    problems.push({
      problem: "AppArmor blocks the sandbox of Chrome.",
      fix: `printf '%s\\n' ${profile.map((line) => `'${line}'`).join(" ")} | sudo tee ${APPARMOR_PROFILE} >/dev/null && sudo apparmor_parser -r ${APPARMOR_PROFILE}`,
    });
  }

  return problems;
};

/** Tells whether the kernel lets only programs with an AppArmor profile use user namespaces, as Ubuntu 23.10 and later do. */
const usernsRestricted = () => {
  try {
    return readFileSync("/proc/sys/kernel/apparmor_restrict_unprivileged_userns", "utf8").trim() === "1";
  } catch {
    return false;
  }
};
