import { Database } from "bun:sqlite";
import { afterAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { StoredBot } from "../bots/BotRepository.ts";
import { findLoginSources, readLogins, siteOf } from "./Logins.ts";

const home = mkdtempSync(join(tmpdir(), "clots-logins-"));
afterAll(() => rmSync(home, { recursive: true, force: true }));

/** Converts a Unix time in milliseconds to Chrome's time: microseconds since 1601. */
const chromeTime = (time: number) => (time + 11_644_473_600_000) * 1000;

/** Makes a bot whose profile has the given cookies, in the columns that Chrome's cookie file has. */
const botWithCookies = (
  id: string,
  projectId: string | null,
  cookies: ReadonlyArray<{
    host: string;
    name: string;
    httpOnly?: boolean;
    updatedAt?: number;
    expiresAt?: number;
  }>,
) => {
  const workingDirectory = join(home, id);
  mkdirSync(join(workingDirectory, ".browser-profile", "Default"), { recursive: true });

  const database = new Database(join(workingDirectory, ".browser-profile", "Default", "Cookies"));
  database.run(
    "CREATE TABLE cookies (host_key TEXT, name TEXT, value TEXT, is_httponly INTEGER, last_update_utc INTEGER, expires_utc INTEGER, has_expires INTEGER)",
  );

  for (const { host, name, httpOnly = true, updatedAt = Date.now(), expiresAt } of cookies) {
    database.run("INSERT INTO cookies VALUES (?, ?, 'secret', ?, ?, ?, ?)", [
      host,
      name,
      httpOnly ? 1 : 0,
      chromeTime(updatedAt),
      expiresAt === undefined ? 0 : chromeTime(expiresAt),
      expiresAt === undefined ? 0 : 1,
    ]);
  }

  database.close();

  return { id, name: id, projectId, workingDirectory } as unknown as StoredBot;
};

test("a page and the cookies of its parent domain share one site", () => {
  expect(siteOf("https://app.example.com/dashboard")).toBe("example.com");
  expect(siteOf("https://example.co.uk")).toBe("example.co.uk");
  expect(siteOf("http://localhost:3000")).toBe("localhost");
  expect(siteOf("about:blank")).toBeUndefined();
});

test("only unexpired HttpOnly cookies count as a login", () => {
  const bot = botWithCookies("reader", null, [
    { host: ".example.com", name: "session", updatedAt: 1_000_000 },
    { host: "app.example.com", name: "device" },
    { host: ".example.com", name: "_ga", httpOnly: false },
    { host: ".old.com", name: "session", expiresAt: Date.now() - 1000 },
  ]);
  const logins = readLogins(join(bot.workingDirectory, ".browser-profile"));

  expect([...logins.keys()]).toEqual(["example.com"]);
  expect([...logins.get("example.com")!.names].toSorted()).toEqual(["device", "session"]);
});

test("a login source is a bot of the same project with cookies that the target lacks", async () => {
  const target = botWithCookies("target", "p1", [{ host: "github.com", name: "_gh_sess" }]);
  const scout = botWithCookies("scout", "p1", [
    { host: "github.com", name: "_gh_sess", updatedAt: Date.now() - 2000 },
    { host: ".github.com", name: "user_session", updatedAt: Date.now() - 2000 },
  ]);
  const writer = botWithCookies("writer", "p1", [
    { host: ".github.com", name: "user_session", updatedAt: Date.now() - 1000 },
  ]);
  const anonymous = botWithCookies("anonymous", "p1", [{ host: "github.com", name: "_gh_sess" }]);
  const elsewhere = botWithCookies("elsewhere", "p2", [
    { host: ".github.com", name: "user_session" },
  ]);

  const sources = await findLoginSources(
    target,
    [target, scout, writer, anonymous, elsewhere],
    "https://github.com/login",
  );

  expect(sources.map((source) => source.bot.name)).toEqual(["writer", "scout"]);
});
