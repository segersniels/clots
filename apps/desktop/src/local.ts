import type { InstallResult, InstallStep, SetupCheck, SetupChecks } from "@clots/contracts";
import { app } from "electron";
import { execFile, spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import { promisify } from "node:util";

/** The address of the clots server on this machine. */
export const LOCAL_SERVER_URL = "http://127.0.0.1:4587";

/** The installed `clots` binary. `clots install` puts it there. */
const INSTALLED_CLOTS = join(homedir(), ".local/share/clots/clots");

/** How long the app waits for the download of Chrome for the bots. */
const BROWSER_TIMEOUT_MS = 10 * 60_000;

/** How long the health check waits for the new server to answer. */
const HEALTH_TIMEOUT_MS = 20_000;

/** How long the app waits for its server to stop before it kills it. */
const STOP_TIMEOUT_MS = 10_000;

/** How long the app waits before it starts its server again after a crash. The background service waits as long. */
const RESTART_DELAY_MS = 3000;

const execFileAsync = promisify(execFile);

/**
 * Reads PATH from the operator's login shell. An app that Finder starts gets a minimal PATH,
 * without `~/.local/bin` where Claude Code installs itself. The service also keeps this PATH.
 */
const readLoginShellPath = () => {
  const marker = "__CLOTS_PATH__";
  const result = spawnSync(
    process.env.SHELL ?? "/bin/zsh",
    ["-ilc", `printf '${marker}%s${marker}' "$PATH"`],
    {
      encoding: "utf8",
      timeout: 5000,
    },
  );

  return (
    new RegExp(`${marker}(.*)${marker}`).exec(result.stdout ?? "")?.[1] ?? process.env.PATH ?? ""
  );
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

const run = (command: string, args: ReadonlyArray<string>, timeout = 60_000) =>
  execFileAsync(command, [...args], { env: environment(), timeout });

/** Shortens a path in the home folder to `~/…` for the checklist. */
const tildify = (path: string) =>
  path.startsWith(homedir()) ? `~${path.slice(homedir().length)}` : path;

const ok = (detail: string): SetupCheck => ({ status: "ok", detail });
const MISSING: SetupCheck = { status: "missing" };

const checkClaude = async (claude: string | undefined) => {
  if (claude === undefined) {
    return MISSING;
  }

  const { stdout } = await run(claude, ["--version"]);

  return ok(`Version ${stdout.trim().split(" ")[0]}, at ${tildify(claude)}`);
};

/** Asks Claude Code for its login. clots supports the subscription login only. */
const checkLogin = async (claude: string | undefined) => {
  if (claude === undefined) {
    return MISSING;
  }

  try {
    const { stdout } = await run(claude, ["auth", "status"]);
    const login = JSON.parse(stdout) as { loggedIn?: boolean; authMethod?: string };

    return login.loggedIn === true && login.authMethod === "claude.ai"
      ? ok("Logged in with a Claude subscription")
      : MISSING;
  } catch {
    return MISSING;
  }
};

const serverAnswers = () =>
  fetch(LOCAL_SERVER_URL, { signal: AbortSignal.timeout(2000) }).then(
    () => true,
    () => false,
  );

/** Waits until the server answers, or throws when it does not answer in time. */
const untilServerAnswers = async () => {
  const deadline = Date.now() + HEALTH_TIMEOUT_MS;

  while (!(await serverAnswers())) {
    // The app's server exits at once when it cannot start, so the app does not wait for the deadline.
    if (ownedServer !== undefined && ownedServer.exitCode !== null) {
      throw new Error("The server stopped right after it started.");
    }

    if (Date.now() > deadline) {
      throw new Error(`The server did not answer at ${LOCAL_SERVER_URL}.`);
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }
};

/**
 * Waits until no server answers. A server that shuts down still holds the port for a moment, and
 * the next server could not start, while the old one would pass the health check.
 */
const untilPortIsFree = async () => {
  const deadline = Date.now() + HEALTH_TIMEOUT_MS;

  while (await serverAnswers()) {
    if (Date.now() > deadline) {
      throw new Error(`Another server still answers at ${LOCAL_SERVER_URL}.`);
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }
};

/** The server that the app runs. It stops when the app quits. */
let ownedServer: ChildProcess | undefined;

/** Set when the app quits, so a move or a restart that still runs starts no server that nothing would stop. */
let quitting = false;

/** Keeps the process id of the app's server, so the next start can stop a server that a crash left behind. */
const ownedServerPidFile = () => join(app.getPath("userData"), "server.pid");

/** Starts the installed server as a process of the app, so it stops when the app quits. */
const spawnOwnedServer = () => {
  if (quitting) {
    return;
  }

  // The variable keeps the server off the tailnet until the operator turns remote access on.
  const server = spawn(INSTALLED_CLOTS, ["serve"], {
    env: { ...environment(), CLOTS_TAILNET: "off" },
    stdio: "ignore",
  });
  ownedServer = server;
  writeFileSync(ownedServerPidFile(), String(server.pid));

  // A server that does not start shows in the health check, which reports it.
  server.once("error", () => undefined);

  // The background service starts a crashed server again, so the app does the same for its own server.
  server.once("exit", () => {
    setTimeout(() => {
      if (ownedServer === server) {
        spawnOwnedServer();
      }
    }, RESTART_DELAY_MS);
  });
};

/** Checks whether a process still runs. */
const isRunning = (pid: number) => {
  try {
    process.kill(pid, 0);

    return true;
  } catch {
    return false;
  }
};

/**
 * Stops the app's server, also one that an earlier start left behind after a crash, and waits
 * until it exits. A server that does not stop in time gets killed.
 */
export const stopOwnedServer = async () => {
  ownedServer = undefined;
  const pid = Number(
    existsSync(ownedServerPidFile()) ? readFileSync(ownedServerPidFile(), "utf8") : Number.NaN,
  );
  rmSync(ownedServerPidFile(), { force: true });

  if (!Number.isInteger(pid)) {
    return;
  }

  // The operating system reuses process ids, so check that this one is still the server.
  const command = spawnSync("ps", ["-p", String(pid), "-o", "command="], { encoding: "utf8" });
  if (!command.stdout.trim().startsWith(`${INSTALLED_CLOTS} serve`)) {
    return;
  }

  process.kill(pid, "SIGTERM");
  const deadline = Date.now() + STOP_TIMEOUT_MS;

  while (isRunning(pid)) {
    if (Date.now() > deadline) {
      process.kill(pid, "SIGKILL");

      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 200));
  }
};

/** Stops the app's server for good when the app quits. The server shuts down on its own, so the quit does not wait for it. */
export const quitServer = () => {
  quitting = true;
  void stopOwnedServer();
};

/**
 * Starts the server as a process of the app. A version from before removes its background
 * service first, which would keep the server running after a quit and hold the port.
 */
const startServer = async () => {
  await run(INSTALLED_CLOTS, ["stop", "--force"]);
  await stopOwnedServer();
  await untilPortIsFree();
  spawnOwnedServer();
};

/** Starts the server and waits until it answers. A window that opens again keeps the server that runs. */
export const runServer = async () => {
  if (ownedServer === undefined || ownedServer.exitCode !== null) {
    await startServer();
  }

  await untilServerAnswers();
};

/** Runs every check that a local clots server needs. */
export const runChecks = async (): Promise<SetupChecks> => {
  const claude = which("claude");
  const [claudeCheck, login, server] = await Promise.all([
    checkClaude(claude),
    checkLogin(claude),
    serverAnswers(),
  ]);

  return {
    claude: claudeCheck,
    login,
    server: server ? ok(`Running at ${LOCAL_SERVER_URL}`) : MISSING,
  };
};

let login: ChildProcess | undefined;

/** Runs `claude auth login`, which opens the browser and waits for its callback. */
export const loginClaude = () =>
  new Promise<void>((resolve) => {
    const claude = which("claude");

    if (claude === undefined) {
      return resolve();
    }

    login = spawn(claude, ["auth", "login"], { env: environment(), stdio: "ignore" });
    login.once("exit", () => resolve());
    login.once("error", () => resolve());
  });

export const cancelLogin = () => {
  login?.kill();
};

/** Asks the installed `clots` for its version. Returns `undefined` when none is installed. */
export const installedVersion = () =>
  run(INSTALLED_CLOTS, ["version"]).then(
    ({ stdout }) => stdout.trim(),
    () => undefined,
  );

/** The `clots` bundle that ships in the app. In development, the bundle that `bun run build:cli` writes. */
const bundledClots = () =>
  app.isPackaged
    ? join(process.resourcesPath, "clots/clots")
    : join(app.getAppPath(), "../../dist", `clots-${process.platform}-${process.arch}`, "clots");

/**
 * Installs the bundled `clots` and starts it as a process of the app, without Tailscale,
 * then waits until the server answers. The log keeps each command's output for the error details.
 */
export const installServer = async (
  onStep: (step: InstallStep) => void,
): Promise<InstallResult> => {
  const log: Array<string> = [];
  const runLogged = async (command: string, args: ReadonlyArray<string>, timeout?: number) => {
    log.push(`$ ${tildify(command)} ${args.join(" ")}`);
    const { stdout, stderr } = await run(command, args, timeout);
    log.push(stdout.trim(), stderr.trim());
  };

  try {
    onStep("install");
    await runLogged(bundledClots(), ["install"]);

    // The download of Chrome can take minutes on a slow network, so it is a step of its own.
    onStep("browser");
    await runLogged(INSTALLED_CLOTS, ["browser"], BROWSER_TIMEOUT_MS);

    // A server from an earlier install still runs the old version, and it holds the port.
    onStep("start");
    await startServer();

    onStep("health");
    await untilServerAnswers();

    return { ok: true };
  } catch (error) {
    const failure = error as Error & { stdout?: string; stderr?: string };
    log.push(failure.stdout?.trim() ?? "", failure.stderr?.trim() ?? "");

    // `clots up` explains its own failures in a line that starts with ✗.
    const explanation = failure.stdout
      ?.split("\n")
      .find((line) => line.startsWith("✗"))
      ?.slice(2);

    return {
      ok: false,
      message: explanation ?? failure.message.split("\n")[0] ?? "The server did not start.",
      log: log.filter((line) => line !== "").join("\n"),
    };
  }
};
