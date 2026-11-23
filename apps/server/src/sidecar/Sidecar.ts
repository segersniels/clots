import { Effect, Layer } from "effect";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { ClotsConfig } from "../config.ts";

/** The sidecar binary that `bun run build` makes from `apps/sidecar`. */
const SIDECAR_BINARY = join(import.meta.dir, "../../../sidecar/clots-sidecar");

/** What the sidecar reports in `status.json`. The Go struct in `apps/sidecar/main.go` matches it. */
export interface SidecarStatus {
  readonly state: "needs_login" | "needs_https" | "ready";
  readonly authUrl?: string;
  readonly url?: string;
}

const stateDirectory = (home: string) => join(home, "tailscale");

/** Reads the last status that the sidecar wrote. Returns `undefined` before the first write. */
export const readSidecarStatus = (home: string): SidecarStatus | undefined => {
  try {
    return JSON.parse(readFileSync(join(stateDirectory(home), "status.json"), "utf8"));
  } catch {
    return undefined;
  }
};

export const sidecarIsBuilt = () => existsSync(SIDECAR_BINARY);

/**
 * Stops the sidecar that an earlier server left behind. `bun --watch` reloads the server inside
 * the same process, so the old sidecar keeps running and two sidecars would share one Tailscale node.
 */
const stopPreviousSidecar = (pidFile: string) => {
  const pid = Number(existsSync(pidFile) ? readFileSync(pidFile, "utf8") : Number.NaN);
  if (!Number.isInteger(pid)) return;

  // The operating system reuses process ids, so check that this one is still a sidecar.
  const command = Bun.spawnSync(["ps", "-p", String(pid), "-o", "comm="]).stdout.toString().trim();
  if (command === "clots-sidecar") process.kill(pid);
};

/** Runs the sidecar for as long as the server runs. Without a built sidecar, clots stays local. */
export const SidecarLayer = Layer.effectDiscard(
  Effect.gen(function* () {
    const config = yield* ClotsConfig;

    if (!sidecarIsBuilt()) {
      yield* Effect.logWarning("The sidecar is not built, so clots is reachable on this machine only.");

      return;
    }

    mkdirSync(stateDirectory(config.home), { recursive: true });
    const pidFile = join(stateDirectory(config.home), "sidecar.pid");

    yield* Effect.acquireRelease(
      Effect.sync(() => {
        stopPreviousSidecar(pidFile);

        const sidecar = Bun.spawn(
          [
            SIDECAR_BINARY,
            "--state-dir",
            stateDirectory(config.home),
            "--upstream",
            `127.0.0.1:${config.webDevPort ?? config.port}`,
          ],
          { stdout: "inherit", stderr: "inherit" },
        );
        writeFileSync(pidFile, String(sidecar.pid));

        return sidecar;
      }),
      (sidecar) => Effect.sync(() => sidecar.kill()),
    );
  }),
);
