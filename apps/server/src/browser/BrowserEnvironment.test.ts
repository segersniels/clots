import { BotId, type ThreadLiveState } from "@clots/contracts";
import { expect, test } from "bun:test";

import { BROWSER_IDLE_MS, isBrowserIdle } from "./BrowserEnvironment.ts";

/** The live state of a bot that does nothing. */
const IDLE: ThreadLiveState = {
  status: "idle",
  steps: [],
  approvals: [],
  handoff: null,
  loginRequest: null,
  tasks: [],
};

/** The moment that the bot or a client last used the browser. */
const usedAt = 1_000_000;

test("a browser is idle after the idle time without use", () => {
  expect(isBrowserIdle(IDLE, 0, usedAt, usedAt + BROWSER_IDLE_MS)).toBe(true);
  expect(isBrowserIdle(IDLE, 0, usedAt, usedAt + BROWSER_IDLE_MS - 1)).toBe(false);
});

test("a browser in use is never idle", () => {
  const later = usedAt + 2 * BROWSER_IDLE_MS;
  const uses: ReadonlyArray<ThreadLiveState> = [
    { ...IDLE, status: "working" },
    { ...IDLE, status: "waiting" },
    { ...IDLE, tasks: [{ id: "task", kind: "agent", description: "Research" }] },
    { ...IDLE, handoff: { id: "handoff", reason: "Log in" } },
    {
      ...IDLE,
      loginRequest: {
        id: "login",
        host: "example.com",
        from: {
          botId: BotId.make("scout"),
          name: "Scout",
          color: "red",
          shape: "drop",
          updatedAt: usedAt,
        },
        state: "asking",
        error: null,
      },
    },
  ];

  for (const live of uses) {
    expect(isBrowserIdle(live, 0, usedAt, later)).toBe(false);
  }

  expect(isBrowserIdle(IDLE, 1, usedAt, later)).toBe(false);
});
