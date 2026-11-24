import type { InstallResult, InstallStep, SetupCheck, SetupChecks } from "@clots/contracts";
import { app } from "electron";
import { execFile, spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import { promisify } from "node:util";

/** The address of the clots server on this machine. */
export const LOCAL_SERVER_URL = "http://127.0.0.1:4587";

/** The installed `clots` binary. `clots install` puts it there. */
const INSTALLED_CLOTS = join(homedir(), ".local/share/clots/clots");

/** How long the health check waits for the new server to answer. */
const HEALTH_TIMEOUT_MS = 20_000;

/** The app bundles where macOS keeps Chrome and Chromium. */
const MAC_BROWSERS = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
];

const execFileAsync = promisify(execFile);

/**
 * Reads PATH from the operator's login shell. An app that Finder starts gets a minimal PATH,
 * without `~/.local/bin` where Claude Code installs itself. The service also keeps this PATH.
 */
const readLoginShellPath = () => {
  const marker = "__CLOTS_PATH__";
  const result = spawnSync(process.env.SHELL ?? "/bin/zsh", ["-ilc", `printf '${marker}%s${marker}' "$PATH"`], {
    encoding: "utf8",
    timeout: 5000,
  });

  return new RegExp(`${marker}(.*)${marker}`).exec(result.stdout ?? "")?.[1] ?? process.env.PATH ?? "";
};

let loginShellPath: string | undefined;

const environment = () => {
  loginShellPath ??= readLoginShellPath();

  return { ...process.env, PATH: loginShellPath };
};

/** Finds a command on the login shell's PATH. */
const which = (command: string) =>
  environment()
    .PATH.split(delimiter)
    .map((directory) => join(directory, command))
    .find((path) => existsSync(path));

const run = (command: string, args: ReadonlyArray<string>) => execFileAsync(command, [...args], { env: environment(), timeout: 60_000 });

/** Shortens a path in the home folder to `~/…` for the checklist. */
const tildify = (path: string) => (path.startsWith(homedir()) ? `~${path.slice(homedir().length)}` : path);

const ok = (detail: string): SetupCheck => ({ status: "ok", detail });
const MISSING: SetupCheck = { status: "missing" };

const checkClaude = async (claude: string | undefined) => {
  if (claude === undefined) return MISSING;

  const { stdout } = await run(claude, ["--version"]);

  return ok(`Version ${stdout.trim().split(" ")[0]}, at ${tildify(claude)}`);
};

/** Asks Claude Code for its login. clots supports the subscription login only. */
const checkLogin = async (claude: string | undefined) => {
  if (claude === undefined) return MISSING;

  try {
    const { stdout } = await run(claude, ["auth", "status"]);
    const login = JSON.parse(stdout) as { loggedIn?: boolean; authMethod?: string };

    return login.loggedIn === true && login.authMethod === "claude.ai" ? ok("Logged in with a Claude subscription") : MISSING;
  } catch {
    return MISSING;
  }
};

const checkBrowser = async () => {
  const browser = MAC_BROWSERS.find((path) => existsSync(path)) ?? which("chromium") ?? which("google-chrome");

  if (browser === undefined) return MISSING;

  // Chrome prints a line such as "Google Chrome 158.0.8127.88".
  const { stdout } = await run(browser, ["--version"]);

  return ok(stdout.trim().replace(/^(.*?\d+)\..*$/, "$1"));
};

const serverAnswers = () =>
  fetch(LOCAL_SERVER_URL, { signal: AbortSignal.timeout(2000) }).then(
    () => true,
    () => false,
  );

/** Runs every check that a local clots server needs. */
export const runChecks = async (): Promise<SetupChecks> => {
  const claude = which("claude");
  const [claudeCheck, login, browser, server] = await Promise.all([
    checkClaude(claude),
    checkLogin(claude),
    checkBrowser(),
    serverAnswers(),
  ]);

  return { claude: claudeCheck, login, browser, server: server ? ok(`Running at ${LOCAL_SERVER_URL}`) : MISSING };
};

let login: ChildProcess | undefined;

/** Runs `claude auth login`, which opens the browser and waits for its callback. */
export const loginClaude = () =>
  new Promise<void>((resolve) => {
    const claude = which("claude");

    if (claude === undefined) return resolve();

    login = spawn(claude, ["auth", "login"], { env: environment(), stdio: "ignore" });
    login.once("exit", () => resolve());
    login.once("error", () => resolve());
  });

export const cancelLogin = () => {
  login?.kill();
};

/** The `clots` bundle that ships in the app. In development, the bundle that `bun run build:cli` writes. */
const bundledClots = () =>
  app.isPackaged
    ? join(process.resourcesPath, "clots/clots")
    : join(app.getAppPath(), "../../dist", `clots-${process.platform}-${process.arch}`, "clots");

/**
 * Installs the bundled `clots` and starts it as a background service without Tailscale, then
 * waits until the server answers. The log keeps each command's output for the error details.
 */
export const installServer = async (onStep: (step: InstallStep) => void): Promise<InstallResult> => {
  const log: Array<string> = [];
  const runLogged = async (command: string, args: ReadonlyArray<string>) => {
    log.push(`$ ${tildify(command)} ${args.join(" ")}`);
    const { stdout, stderr } = await run(command, args);
    log.push(stdout.trim(), stderr.trim());
  };

  try {
    onStep("install");
    await runLogged(bundledClots(), ["install"]);

    onStep("start");
    await runLogged(INSTALLED_CLOTS, ["up", "--local"]);

    onStep("health");
    const deadline = Date.now() + HEALTH_TIMEOUT_MS;
    while (!(await serverAnswers())) {
      if (Date.now() > deadline) throw new Error(`The server did not answer at ${LOCAL_SERVER_URL}.`);

      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    return { ok: true };
  } catch (error) {
    const failure = error as Error & { stdout?: string; stderr?: string };
    log.push(failure.stdout?.trim() ?? "", failure.stderr?.trim() ?? "");

    // `clots up` explains its own failures in a line that starts with ✗.
    const explanation = failure.stdout?.split("\n").find((line) => line.startsWith("✗"))?.slice(2);

    return {
      ok: false,
      message: explanation ?? failure.message.split("\n")[0] ?? "The server did not start.",
      log: log.filter((line) => line !== "").join("\n"),
    };
  }
};
