import type { RemoteAccess } from "@clots/contracts";
import { Context, Effect, Layer } from "effect";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { ClotsConfig } from "../config.ts";
import { runtimePaths } from "../paths.ts";

/** The sidecar binary that the build makes from `apps/sidecar`. */
const SIDECAR_BINARY = runtimePaths.sidecar;

/** What the sidecar reports in `status.json`. The Go struct in `apps/sidecar/main.go` matches it. */
export interface SidecarStatus {
  readonly state: "needs_login" | "needs_https" | "ready";
  readonly authUrl?: string;
  readonly url?: string;
}

const stateDirectory = (home: string) => join(home, "tailscale");

/** The file that keeps the operator's choice for remote access: `on` or `off`. */
const choiceFile = (home: string) => join(home, "remote-access");

/** Reads the last status that the sidecar wrote. Returns `undefined` before the first write. */
export const readSidecarStatus = (home: string): SidecarStatus | undefined => {
  try {
    return JSON.parse(readFileSync(join(stateDirectory(home), "status.json"), "utf8"));
  } catch {
    return undefined;
  }
};

/** Reads the operator's choice for remote access. Returns `undefined` when the operator never chose. */
export const readRemoteAccessChoice = (home: string): boolean | undefined => {
  try {
    return readFileSync(choiceFile(home), "utf8").trim() === "on";
  } catch {
    return undefined;
  }
};

/** Keeps the operator's choice for remote access, so the next start of the server follows it. */
export const writeRemoteAccessChoice = (home: string, enabled: boolean) => {
  mkdirSync(home, { recursive: true });
  writeFileSync(choiceFile(home), enabled ? "on" : "off");
};

export const sidecarIsBuilt = () => existsSync(SIDECAR_BINARY);

/**
 * Stops the sidecar that an earlier server left behind. `bun --watch` reloads the server inside
 * the same process, so the old sidecar keeps running and two sidecars would share one Tailscale node.
 */
const stopPreviousSidecar = (pidFile: string) => {
  const pid = Number(existsSync(pidFile) ? readFileSync(pidFile, "utf8") : Number.NaN);
  if (!Number.isInteger(pid)) {
    return;
  }

  // The operating system reuses process ids, so check that this one is still a sidecar.
  const command = Bun.spawnSync(["ps", "-p", String(pid), "-o", "comm="])
    .stdout.toString()
    .trim();

  if (command === "clots-sidecar") {
    process.kill(pid);
  }
};

/**
 * Runs the sidecar while remote access is on, for as long as the server runs. The operator's
 * stored choice decides. Before the first choice, `ClotsConfig.tailnet` does.
 */
export class Sidecar extends Context.Service<
  Sidecar,
  {
    readonly status: Effect.Effect<RemoteAccess>;
    /** Starts or stops the sidecar and keeps the choice. Returns the new state. */
    setEnabled(enabled: boolean): Effect.Effect<RemoteAccess>;
  }
>()("clots/sidecar/Sidecar") {
  static readonly layer = Layer.effect(
    Sidecar,
    Effect.gen(function* () {
      const config = yield* ClotsConfig;
      const directory = stateDirectory(config.home);
      const pidFile = join(directory, "sidecar.pid");
      let enabled = readRemoteAccessChoice(config.home) ?? config.tailnet;
      let sidecar: Bun.Subprocess | undefined;

      /** Starts the sidecar, after it stops one that an earlier start left behind. */
      const start = () => {
        mkdirSync(directory, { recursive: true });
        stopPreviousSidecar(pidFile);

        sidecar = Bun.spawn(
          [
            SIDECAR_BINARY,
            "--state-dir",
            directory,
            "--upstream",
            `127.0.0.1:${config.webDevPort ?? config.port}`,
          ],
          { stdout: "inherit", stderr: "inherit" },
        );
        writeFileSync(pidFile, String(sidecar.pid));
      };

      /** Stops the sidecar of this server or of an earlier start, and removes its status. */
      const stop = () => {
        sidecar?.kill();
        sidecar = undefined;
        stopPreviousSidecar(pidFile);
        rmSync(join(directory, "status.json"), { force: true });
      };

      /** Reads the state of remote access from the choice and the status file of the sidecar. */
      const read = (): RemoteAccess => {
        if (!sidecarIsBuilt()) {
          return { state: "unavailable" };
        }

        if (!enabled) {
          return { state: "off" };
        }

        const status = readSidecarStatus(config.home);
        if (status === undefined) {
          return { state: "starting" };
        }

        return {
          state: status.state,
          ...(status.authUrl === undefined ? {} : { authUrl: status.authUrl }),
          ...(status.url === undefined ? {} : { url: status.url }),
        };
      };

      if (!sidecarIsBuilt()) {
        yield* Effect.logWarning(
          "The sidecar is not built, so clots is reachable on this machine only.",
        );
      } else if (enabled) {
        start();
      } else {
        stop();
        yield* Effect.logInfo("Remote access is off, so clots is reachable on this machine only.");
      }

      yield* Effect.addFinalizer(() => Effect.sync(() => sidecar?.kill()));

      return Sidecar.of({
        status: Effect.sync(read),

        setEnabled: (next) =>
          Effect.sync(() => {
            if (!sidecarIsBuilt() || next === enabled) {
              return read();
            }

            writeRemoteAccessChoice(config.home, next);
            enabled = next;

            if (next) {
              start();
            } else {
              stop();
            }

            return read();
          }),
      });
    }),
  );
}
