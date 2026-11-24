import { query } from "@anthropic-ai/claude-agent-sdk";
import type { Account, UsageWindow } from "@clots/contracts";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { makeClaudeEnvironment } from "../bots/ClaudeEnvironment.ts";

/** How long the server reuses an answer. Each check starts a short `claude` process. */
const CACHE_MS = 60_000;

/** How long one question to Claude Code may take before the menu shows it as unknown. */
const CHECK_TIMEOUT_MS = 15_000;

/** A limit window as Claude Code's usage data has it. */
interface RateWindow {
  readonly utilization: number | null;
  readonly resets_at: string | null;
}

/** An entry of the usage data's `limits` list. The SDK types leave the list out, so only the fields clots reads are here. */
interface LimitEntry {
  readonly kind?: string;
  readonly severity?: string;
  readonly scope?: { readonly model?: { readonly display_name?: string } } | null;
}

/** The profile fields that clots reads from Claude Code's own config. */
interface ClaudeProfile {
  readonly name: string | null;
  readonly plan: string | null;
}

const textOrNull = (value: unknown) => (typeof value === "string" && value.trim() !== "" ? value.trim() : null);

/**
 * Reads the name and the plan name from the profile that Claude Code keeps in its config. The file
 * holds more than that, so only these fields leave this function. It holds no tokens.
 */
const readProfile = (): ClaudeProfile => {
  const directory = process.env.CLAUDE_CONFIG_DIR;
  const path = directory === undefined ? join(homedir(), ".claude.json") : join(directory, ".claude.json");

  try {
    const profile = JSON.parse(readFileSync(path, "utf8")).oauthAccount ?? {};

    return { name: textOrNull(profile.fullName) ?? textOrNull(profile.displayName), plan: textOrNull(profile.planDisplayName) };
  } catch {
    return { name: null, plan: null };
  }
};

/** Waits for a question to Claude Code, or gives `null` when it takes too long or fails. */
const withTimeout = <A>(question: Promise<A>) =>
  Promise.race([question, new Promise<null>((resolve) => setTimeout(() => resolve(null), CHECK_TIMEOUT_MS))]).catch(() => null);

/** Turns Claude Code's usage data into the windows that the menu shows. */
const toWindows = (limits: Record<string, unknown> | null | undefined): ReadonlyArray<UsageWindow> | null => {
  if (limits === null || limits === undefined) return null;

  // Only the `limits` list says which windows are close to their limit.
  const critical = ((limits.limits as ReadonlyArray<LimitEntry> | undefined) ?? []).filter((entry) => entry.severity === "critical");
  const isCritical = (kind: string, model: string | null) =>
    critical.some((entry) => entry.kind === kind && (entry.scope?.model?.display_name ?? null) === model);

  const window = (kind: UsageWindow["kind"], rate: RateWindow | null | undefined, model: string | null, limitKind: string) =>
    rate?.utilization === null || rate?.utilization === undefined
      ? []
      : [
          {
            kind,
            model,
            percent: rate.utilization,
            resetsAt: rate.resets_at === null ? null : Date.parse(rate.resets_at),
            critical: isCritical(limitKind, model),
          },
        ];
  const scoped = (limits.model_scoped as ReadonlyArray<RateWindow & { display_name: string }> | undefined) ?? [];

  return [
    ...window("session", limits.five_hour as RateWindow | null | undefined, null, "session"),
    ...window("weekly", limits.seven_day as RateWindow | null | undefined, null, "weekly_all"),
    ...scoped.flatMap((model) => window("model", model, model.display_name, "weekly_scoped")),
  ];
};

/**
 * Asks a `claude` process without a prompt for its login and the data behind its `/usage` command.
 * Claude Code answers with its own login, so clots never reads a token, and no model runs.
 */
const askClaudeCode = async (claudePath: string, home: string): Promise<Account> => {
  const never: AsyncIterable<never> = { [Symbol.asyncIterator]: () => ({ next: () => new Promise<never>(() => {}) }) };
  const probe = query({
    prompt: never,
    options: { cwd: home, env: makeClaudeEnvironment(process.env), pathToClaudeCodeExecutable: claudePath, persistSession: false },
  });

  try {
    const info = await withTimeout(probe.accountInfo());

    // Claude Code did not answer, so the menu shows the plan and its usage as unknown.
    if (info === null) return { name: null, email: null, plan: "Claude", usage: null, checkedAt: Date.now() };

    const profile = readProfile();

    // The SDK marks this call as experimental, so a change of its name or shape shows as unknown usage, not as an error.
    const usage = await withTimeout(probe.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET({ skipBehaviors: true }));

    return {
      name: profile.name,
      email: info.email ?? null,
      // The profile has the short name, such as "Ultra". Claude Code's own name, such as "Claude Ultra", is the fallback.
      plan: profile.plan ?? info.subscriptionType?.replace(/^Claude /, "") ?? "Claude",
      usage: toWindows(usage?.rate_limits as Record<string, unknown> | null | undefined),
      checkedAt: Date.now(),
    };
  } finally {
    probe.close();
  }
};

let cached: Account | undefined;

/** Reads the server's Claude login and the usage limits of its plan, at most once a minute. */
export const readAccount = async (claudePath: string, home: string): Promise<Account> => {
  if (cached !== undefined && Date.now() - cached.checkedAt < CACHE_MS) return cached;

  cached = await askClaudeCode(claudePath, home);

  return cached;
};
