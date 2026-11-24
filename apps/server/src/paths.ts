import { dirname, join } from "node:path";

/** Tells whether this process is the compiled `clots` binary. Bun serves the bundled code from `/$bunfs/`. */
const isCompiled = import.meta.dir.startsWith("/$bunfs/");

/** The root of the clots checkout, when clots runs from source. */
const checkout = join(import.meta.dir, "../../..");

/** The folder of the compiled binary. `process.execPath` resolves a symlink such as `~/.local/bin/clots`. */
const installation = dirname(process.execPath);

/** The files that clots needs at run time. */
interface RuntimePaths {
  /** The built web client. */
  readonly webRoot: string;
  /** The Tailscale sidecar binary. */
  readonly sidecar: string;
  /** The real `agent-browser` CLI. */
  readonly agentBrowser: string;
  /** The folder of clots' own `agent-browser` wrapper, which starts the bot's Chrome first. */
  readonly wrapperDirectory: string;
  /** The command that the background service runs. */
  readonly serveCommand: ReadonlyArray<string>;
}

/**
 * Locates the run-time files. A checkout keeps them where `bun run build` puts them. An
 * installation keeps them next to the binary, in the layout that `scripts/build-cli.ts` writes.
 */
export const runtimePaths: RuntimePaths = isCompiled
  ? {
      webRoot: join(installation, "web"),
      sidecar: join(installation, "clots-sidecar"),
      agentBrowser: join(installation, "libexec/agent-browser"),
      wrapperDirectory: join(installation, "bin"),
      serveCommand: [process.execPath, "serve"],
    }
  : {
      webRoot: join(checkout, "apps/web/dist"),
      sidecar: join(checkout, "apps/sidecar/clots-sidecar"),
      agentBrowser: join(checkout, "apps/server/node_modules/.bin/agent-browser"),
      wrapperDirectory: join(checkout, "apps/server/bin"),
      serveCommand: [process.execPath, join(checkout, "apps/server/src/cli.ts"), "serve"],
    };

/** Tells whether this process runs from an installation, not from a checkout. */
export const runsInstalled = isCompiled;
