import { cpSync, mkdirSync, renameSync, rmSync, symlinkSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/** The folder that holds an installed clots: the binary and the files that ship next to it. */
export const INSTALL_DIRECTORY = join(homedir(), ".local/share/clots");

/** The folder that gets the `clots` command. Neither folder needs root. */
const COMMAND_DIRECTORY = join(homedir(), ".local/bin");

/**
 * Copies a bundle, by default the one of the running binary, to the install folder and links the
 * `clots` command to it. A new folder replaces the old one in one rename, so a running server keeps
 * its open files.
 */
export const installBundle = (bundle = dirname(process.execPath)) => {
  const staging = `${INSTALL_DIRECTORY}.new`;

  rmSync(staging, { recursive: true, force: true });
  cpSync(bundle, staging, { recursive: true });
  rmSync(INSTALL_DIRECTORY, { recursive: true, force: true });
  renameSync(staging, INSTALL_DIRECTORY);

  const command = join(COMMAND_DIRECTORY, "clots");
  mkdirSync(COMMAND_DIRECTORY, { recursive: true });
  rmSync(command, { force: true });
  symlinkSync(join(INSTALL_DIRECTORY, "clots"), command);

  return {
    command,
    onPath: (process.env.PATH ?? "").split(":").includes(COMMAND_DIRECTORY),
  };
};
