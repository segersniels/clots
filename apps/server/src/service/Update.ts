import { isNewerVersion } from "@clots/contracts";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { runsInstalled } from "../paths.ts";
import { CLOTS_VERSION } from "../version.ts";
import { INSTALL_DIRECTORY, installBundle } from "./Install.ts";
import { serviceIsRunning } from "./Service.ts";

/** The latest clots release on GitHub. A fork can point this at its own releases. */
const LATEST_RELEASE_URL =
  process.env.CLOTS_RELEASES_URL ??
  "https://api.github.com/repos/segersniels/clots/releases/latest";

/**
 * How long a release check answers again, so that clients which ask at once share one call. GitHub
 * allows 60 unauthenticated API calls per hour.
 */
const CHECK_INTERVAL_MS = 60_000;

/** The bundle of this platform in a release, as the release workflow names it. */
const BUNDLE_NAME = `clots-${process.platform}-${process.arch}`;

export interface Release {
  readonly version: string;
  /** The release page, for the desktop app, which does not update itself yet. */
  readonly url: string;
  /** The bundle of this platform, if the release has one. */
  readonly bundleUrl: string | undefined;
}

interface GitHubRelease {
  readonly tag_name: string;
  readonly html_url: string;
  readonly assets: ReadonlyArray<{ readonly name: string; readonly browser_download_url: string }>;
}

let lastCheck: { readonly at: number; readonly release: Release | undefined } | undefined;

/** Fetches the latest release, at most once per check interval. Returns `undefined` when GitHub does not answer. */
export const latestRelease = async (): Promise<Release | undefined> => {
  if (lastCheck !== undefined && Date.now() - lastCheck.at < CHECK_INTERVAL_MS) {
    return lastCheck.release;
  }

  const release = await fetch(LATEST_RELEASE_URL, {
    headers: { "User-Agent": "clots", Accept: "application/vnd.github+json" },
  })
    .then((response) => (response.ok ? (response.json() as Promise<GitHubRelease>) : undefined))
    .then((found) =>
      found === undefined
        ? undefined
        : {
            version: found.tag_name.replace(/^v/, ""),
            url: found.html_url,
            bundleUrl: found.assets.find((asset) => asset.name === `${BUNDLE_NAME}.tar.gz`)
              ?.browser_download_url,
          },
    )
    .catch(() => undefined);

  // A failed check is not kept, so the next ask tries GitHub again.
  if (release !== undefined) {
    lastCheck = { at: Date.now(), release };
  }

  return release;
};

/**
 * Tells whether this server can replace itself: it must be the installed binary, and the
 * background service must run it, so that the service starts the new version.
 */
export const canUpdateServer = () =>
  runsInstalled && dirname(process.execPath) === INSTALL_DIRECTORY && serviceIsRunning();

/** Returns the latest release when this server can install it, or explains why it cannot. */
export const availableServerUpdate = async () => {
  const release = await latestRelease();

  if (release === undefined) {
    throw new Error("GitHub did not answer. Try again later.");
  }

  if (!isNewerVersion(release.version, CLOTS_VERSION)) {
    throw new Error(`clots ${CLOTS_VERSION} is the latest version.`);
  }

  if (!canUpdateServer()) {
    throw new Error(
      "This server does not run as an installed service, so it cannot update itself.",
    );
  }

  return release;
};

/**
 * Downloads the release bundle of this platform and installs it over the current one. The caller
 * restarts the server afterwards, because the running process keeps the old binary.
 */
export const installRelease = async (release: Release) => {
  if (release.bundleUrl === undefined) {
    throw new Error(
      `Release ${release.version} has no build for ${process.platform}-${process.arch}.`,
    );
  }

  const download = mkdtempSync(join(tmpdir(), "clots-update-"));

  try {
    const response = await fetch(release.bundleUrl);

    if (!response.ok) {
      throw new Error(`The download failed with HTTP ${response.status}.`);
    }

    const archive = join(download, `${BUNDLE_NAME}.tar.gz`);
    await Bun.write(archive, response);

    const extract = Bun.spawnSync(["tar", "-xzf", archive, "-C", download], { stderr: "pipe" });

    if (extract.exitCode !== 0) {
      throw new Error(`The archive did not unpack: ${extract.stderr.toString().trim()}`);
    }

    installBundle(join(download, BUNDLE_NAME));
  } finally {
    rmSync(download, { recursive: true, force: true });
  }
};

/** Describes this server's version and the latest release for the clients. */
export const updateInfo = async () => {
  const release = await latestRelease();

  if (release === undefined) {
    return { current: CLOTS_VERSION, serverUpdate: false };
  }

  return {
    current: CLOTS_VERSION,
    latest: { version: release.version, url: release.url },
    serverUpdate:
      isNewerVersion(release.version, CLOTS_VERSION) &&
      release.bundleUrl !== undefined &&
      canUpdateServer(),
  };
};
