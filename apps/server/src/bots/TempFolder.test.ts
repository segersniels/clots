import { expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { StoredBot } from "./BotRepository.ts";
import {
  botTempDirectory,
  decideWarning,
  measureSessionFolder,
  WARNING_STEP_KB,
  removeOldSessionFolders,
} from "./TempFolder.ts";

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

test("the measurement names the session folder and its size", async () => {
  const bot = newBot();
  const folder = makeSessionFolder(bot, "current");

  const measured = await measureSessionFolder(bot, "current");

  expect(measured?.path).toBe(folder);
  expect(measured?.kb).toBeGreaterThanOrEqual(3 * 1024);
});

test("a session without a folder has no measurement", async () => {
  expect(await measureSessionFolder(newBot(), "current")).toBeUndefined();
});

test("a folder below the limit gets no warning and forgets the last one", () => {
  expect(decideWarning(500, 2000, 1000)).toEqual({ warn: false, warnedKb: null });
});

test("a folder above the limit gets a warning the first time", () => {
  expect(decideWarning(1500, null, 1000)).toEqual({ warn: true, warnedKb: 1500 });
});

test("a folder that shrank since the last warning remembers the smaller size", () => {
  expect(decideWarning(1400, 1500, 1000)).toEqual({ warn: false, warnedKb: 1400 });
});

test("a folder that grew by less than a step gets no new warning", () => {
  const grown = 1500 + WARNING_STEP_KB;

  expect(decideWarning(grown, 1500, 1000)).toEqual({ warn: false, warnedKb: 1500 });
});

test("a folder that grew by more than a step gets a new warning", () => {
  const grown = 1500 + WARNING_STEP_KB + 1;

  expect(decideWarning(grown, 1500, 1000)).toEqual({ warn: true, warnedKb: grown });
});

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
