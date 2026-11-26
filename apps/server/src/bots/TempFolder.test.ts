import { expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { StoredBot } from "./BotRepository.ts";
import { botTempDirectory, removeOldSessionFolders } from "./TempFolder.ts";

/** Makes a bot with a new, empty notes directory. Only the directory matters here. */
const newBot = () =>
  ({ workingDirectory: mkdtempSync(join(tmpdir(), "clots-temp-")) }) as StoredBot;

/** Makes a session folder the way Claude Code lays it out, with a 3 MB file in its scratchpad. */
const makeSessionFolder = (bot: StoredBot, sessionId: string) => {
  const folder = join(
    botTempDirectory(bot),
    `claude-${process.getuid?.() ?? 0}`,
    "-home-me-project",
    sessionId,
  );
  mkdirSync(join(folder, "scratchpad"), { recursive: true });
  writeFileSync(join(folder, "scratchpad", "data.csv"), Buffer.alloc(3 * 1024 * 1024, 1));

  return folder;
};

test("the folders of old sessions go, and the current one stays", () => {
  const bot = newBot();
  const current = makeSessionFolder(bot, "current");
  const old = makeSessionFolder(bot, "old");

  removeOldSessionFolders(bot, "current");

  expect(existsSync(current)).toBe(true);
  expect(existsSync(old)).toBe(false);
});

test("a bot without a session loses all session folders", () => {
  const bot = newBot();
  const old = makeSessionFolder(bot, "old");

  removeOldSessionFolders(bot, null);

  expect(existsSync(old)).toBe(false);
});
