import { Database } from "bun:sqlite";
import { copyFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getDomain } from "tldts";

import type { StoredBot } from "../bots/BotRepository.ts";
import { ensureChrome, closeChrome, isRunning, readPages, type BotChrome } from "./BotChrome.ts";
import { browserProfile, devToolsPort } from "./BrowserEnvironment.ts";

/** The time from the Chrome epoch, 1601-01-01, to the Unix epoch, in milliseconds. */
const CHROME_EPOCH_OFFSET_MS = 11_644_473_600_000;

/** The login of a bot on one site, from the HttpOnly cookies in its profile. */
export interface SiteLogin {
  /** The names of the HttpOnly cookies. Another bot with names that this bot lacks has a login that this bot has not. */
  readonly names: ReadonlySet<string>;
  /** The time of the latest cookie change, in Unix milliseconds. */
  readonly updatedAt: number;
}

/**
 * Finds the site of a host: its registrable domain, so that a cookie on `.example.com` and the page
 * `app.example.com` share the site `example.com`. A host without one, such as `localhost`, is its own site.
 */
const siteOfHost = (host: string) => {
  const bare = host.replace(/^\./, "");

  return getDomain(bare, { allowPrivateDomains: true }) ?? bare;
};

/** Finds the site of a web address, or `undefined` for a page that is not on the web, such as `about:blank`. */
export const siteOf = (url: string) => {
  const parsed = URL.parse(url);

  if (parsed === null || (parsed.protocol !== "https:" && parsed.protocol !== "http:")) return undefined;

  return siteOfHost(parsed.hostname);
};

/** One unexpired HttpOnly cookie, as the cookie file of a Chrome profile stores it. */
interface CookieRow {
  readonly host: string;
  readonly name: string;
  readonly updated: number;
}

const readCookieFile = (file: string) => {
  const database = new Database(file, { readonly: true });
  const now = (Date.now() + CHROME_EPOCH_OFFSET_MS) * 1000;

  try {
    return database
      .query<CookieRow, [number]>(
        "SELECT host_key AS host, name, last_update_utc AS updated FROM cookies WHERE is_httponly = 1 AND (has_expires = 0 OR expires_utc > ?)",
      )
      .all(now);
  } finally {
    database.close();
  }
};

/**
 * Reads the logins of a Chrome profile by site. The cookie file keeps the host, the name, the flags
 * and the times in plain text, so this works while the profile's Chrome is closed, and it never
 * reads a cookie value. Only HttpOnly cookies count, which keeps out analytics and consent cookies.
 */
export const readLogins = (profile: string): ReadonlyMap<string, SiteLogin> => {
  const file = join(profile, "Default", "Cookies");

  if (!existsSync(file)) return new Map();

  let rows: ReadonlyArray<CookieRow>;
  try {
    rows = readCookieFile(file);
  } catch {
    // A running Chrome can lock its cookie file, so the server reads a copy.
    const copy = join(tmpdir(), `clots-cookies-${crypto.randomUUID()}`);
    copyFileSync(file, copy);
    try {
      rows = readCookieFile(copy);
    } finally {
      rmSync(copy, { force: true });
    }
  }

  const logins = new Map<string, { names: Set<string>; updatedAt: number }>();
  for (const row of rows) {
    const site = siteOfHost(row.host);
    const login = logins.get(site) ?? { names: new Set<string>(), updatedAt: 0 };
    login.names.add(row.name);
    login.updatedAt = Math.max(login.updatedAt, row.updated / 1000 - CHROME_EPOCH_OFFSET_MS);
    logins.set(site, login);
  }

  return logins;
};

/** A cookie as the DevTools protocol reports it. */
interface Cookie {
  readonly name: string;
  readonly value: string;
  readonly domain: string;
  readonly path: string;
  readonly expires: number;
  readonly httpOnly: boolean;
  readonly secure: boolean;
  readonly session: boolean;
  readonly sameSite?: string;
  readonly priority?: string;
  readonly sourceScheme?: string;
  readonly sourcePort?: number;
  readonly partitionKey?: unknown;
}

/** A DevTools connection to the browser target of one Chrome. */
const connect = async (port: number) => {
  const version = (await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()) as { webSocketDebuggerUrl: string };
  const socket = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.onopen = resolve;
    socket.onerror = () => reject(new Error(`No DevTools connection on port ${port}.`));
  });

  let lastId = 0;
  const replies = new Map<number, { resolve: (result: any) => void; reject: (error: Error) => void }>();
  const listeners = new Set<(event: { method: string; params: any; sessionId?: string }) => void>();

  socket.onmessage = ({ data }) => {
    const message = JSON.parse(String(data));
    if (message.id === undefined) {
      for (const listener of listeners) listener(message);

      return;
    }

    const reply = replies.get(message.id);
    replies.delete(message.id);
    if (message.error === undefined) reply?.resolve(message.result);
    else reply?.reject(new Error(message.error.message));
  };

  const send = (method: string, params: object = {}, sessionId?: string): Promise<any> =>
    new Promise((resolve, reject) => {
      const id = ++lastId;
      replies.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params, sessionId }));
    });

  return { send, listeners, close: () => socket.close() };
};

type Connection = Awaited<ReturnType<typeof connect>>;

/**
 * Runs `use` in a hidden page of the origin whose requests all get an empty page, so the page has
 * the origin's localStorage while the site itself never loads.
 */
const inEmptyPage = async <A>(browser: Connection, origin: string, use: (evaluate: (expression: string) => Promise<any>) => Promise<A>) => {
  const { targetId } = await browser.send("Target.createTarget", { url: "about:blank", background: true, hidden: true });

  try {
    const { sessionId } = await browser.send("Target.attachToTarget", { targetId, flatten: true });
    const answerEmpty = (event: { method: string; params: any; sessionId?: string }) => {
      if (event.method !== "Fetch.requestPaused" || event.sessionId !== sessionId) return;

      void browser.send(
        "Fetch.fulfillRequest",
        { requestId: event.params.requestId, responseCode: 200, responseHeaders: [{ name: "Content-Type", value: "text/html" }], body: "" },
        sessionId,
      );
    };
    browser.listeners.add(answerEmpty);
    await browser.send("Fetch.enable", { patterns: [{ urlPattern: "*" }] }, sessionId);
    await browser.send("Page.enable", {}, sessionId);

    const loaded = new Promise<void>((resolve) => {
      const onLoad = (event: { method: string; sessionId?: string }) => {
        if (event.method !== "Page.loadEventFired" || event.sessionId !== sessionId) return;

        browser.listeners.delete(onLoad);
        resolve();
      };
      browser.listeners.add(onLoad);
    });
    await browser.send("Page.navigate", { url: `${origin}/` }, sessionId);
    await loaded;
    browser.listeners.delete(answerEmpty);

    return await use(async (expression) => {
      const { result, exceptionDetails } = await browser.send("Runtime.evaluate", { expression, returnByValue: true }, sessionId);

      if (exceptionDetails !== undefined) throw new Error(exceptionDetails.text);

      return result.value;
    });
  } finally {
    await browser.send("Target.closeTarget", { targetId }).catch(() => undefined);
  }
};

/** Builds the DevTools parameters that set a cookie again as it was. A cookie without a leading dot belongs to its host only. */
const toCookieParam = ({ name, value, domain, path, expires, httpOnly, secure, session, sameSite, priority, sourceScheme, sourcePort, partitionKey }: Cookie) => ({
  name,
  value,
  path,
  httpOnly,
  secure,
  sameSite,
  priority,
  sourceScheme,
  sourcePort,
  partitionKey,
  ...(session ? {} : { expires }),
  ...(domain.startsWith(".") ? { domain } : { url: `${secure ? "https" : "http"}://${domain}${path}` }),
});

/**
 * Copies one site's cookies and the page origin's localStorage from one bot's Chrome to another's,
 * and reloads the pages of the target that show the site. The source's Chrome starts for the copy
 * when it does not run, and closes again after it. The values pass through the server only.
 */
export const copyLogin = async (source: BotChrome, target: BotChrome, url: string) => {
  const site = siteOf(url);

  if (site === undefined) throw new Error("The page is not on a website.");

  const origin = new URL(url).origin;
  const sourceRan = await isRunning(source.port);
  await ensureChrome(source);
  await ensureChrome(target);
  const from = await connect(source.port);
  const to = await connect(target.port);

  try {
    const { cookies } = (await from.send("Storage.getCookies")) as { cookies: ReadonlyArray<Cookie> };
    const siteCookies = cookies.filter((cookie) => siteOfHost(cookie.domain) === site);

    if (siteCookies.length === 0) throw new Error(`The other bot has no login on ${site} anymore.`);

    const storage = (await inEmptyPage(from, origin, (evaluate) => evaluate("Object.entries(localStorage)"))) as ReadonlyArray<[string, string]>;

    await to.send("Storage.setCookies", { cookies: siteCookies.map(toCookieParam) });
    if (storage.length > 0) {
      await inEmptyPage(to, origin, (evaluate) =>
        evaluate(`for (const [key, value] of ${JSON.stringify(storage)}) localStorage.setItem(key, value)`),
      );
    }

    for (const page of await readPages(target.port)) {
      if (siteOf(page.url) !== site) continue;

      const { sessionId } = await to.send("Target.attachToTarget", { targetId: page.targetId, flatten: true });
      await to.send("Page.reload", {}, sessionId);
      await to.send("Target.detachFromTarget", { sessionId });
    }
  } finally {
    from.close();
    to.close();
    if (!sourceRan) await closeChrome(source.port);
  }
};

/**
 * Reads the names of the HttpOnly cookies that a running Chrome has on a site, or `undefined` when
 * the Chrome does not run. Chrome writes its cookie file only every 30 seconds or so, so the file
 * misses a login of the last moments.
 */
const liveLoginNames = async (port: number, site: string) => {
  if (!(await isRunning(port))) return undefined;

  const browser = await connect(port);

  try {
    const { cookies } = (await browser.send("Storage.getCookies")) as { cookies: ReadonlyArray<Cookie> };

    return new Set(cookies.filter((cookie) => cookie.httpOnly && siteOfHost(cookie.domain) === site).map((cookie) => cookie.name));
  } finally {
    browser.close();
  }
};

/**
 * Finds the other bots of the target's project that are logged in on the site of a page, latest
 * first. A bot counts when it has HttpOnly cookies there that the target lacks, so a site's
 * anonymous cookies, which the target gets on its first visit, do not hide another bot's login.
 */
export const findLoginSources = async (target: StoredBot, bots: ReadonlyArray<StoredBot>, url: string) => {
  const site = siteOf(url);
  if (site === undefined) return [];

  const own =
    (await liveLoginNames(devToolsPort(target), site)) ?? readLogins(browserProfile(target)).get(site)?.names ?? new Set<string>();
  const sources = bots.flatMap((bot) => {
    if (bot.id === target.id || bot.projectId !== target.projectId) return [];

    const login = readLogins(browserProfile(bot)).get(site);
    if (login === undefined || [...login.names].every((name) => own.has(name))) return [];

    return [{ bot, updatedAt: login.updatedAt }];
  });

  return sources.toSorted((a, b) => b.updatedAt - a.updatedAt);
};
