import type { BotId, Message } from "@clots/contracts";
import { expect, test } from "bun:test";

import { applyThreadEvent, emptyThread } from "./thread.ts";

const message = (sequence: number, role: Message["role"], text: string): Message => ({
  id: `m${sequence}`,
  botId: "bot" as BotId,
  sequence,
  role,
  text,
  attachments: [],
  steps: [],
  createdAt: sequence,
});

test("a replayed message that the client already has does not appear twice", () => {
  const first = applyThreadEvent(emptyThread, {
    _tag: "Message",
    message: message(1, "user", "hi"),
  });
  const replayed = applyThreadEvent(first, { _tag: "Message", message: message(1, "user", "hi") });

  expect(replayed.messages).toHaveLength(1);
  expect(replayed.lastSequence).toBe(1);
});

test("the live state marks the thread as synced", () => {
  const synced = applyThreadEvent(emptyThread, {
    _tag: "Live",
    state: { ...emptyThread.live, status: "working" },
  });

  expect(synced.synced).toBe(true);
  expect(synced.live.status).toBe("working");
});

test("the first live state of a subscription ends its replay, and later messages count as live", () => {
  const live = { _tag: "Live", state: emptyThread.live } as const;
  const subscribed = applyThreadEvent(emptyThread, { _tag: "Subscribed" });
  const replayed = applyThreadEvent(subscribed, {
    _tag: "Message",
    message: message(1, "assistant", "missed"),
  });
  const caughtUp = applyThreadEvent(replayed, live);
  const later = applyThreadEvent(
    applyThreadEvent(caughtUp, { _tag: "Message", message: message(2, "assistant", "new") }),
    live,
  );

  expect(replayed.replayedThrough).toBe(Number.POSITIVE_INFINITY);
  expect(caughtUp.replayedThrough).toBe(1);
  expect(later.replayedThrough).toBe(1);
  expect(applyThreadEvent(later, { _tag: "Subscribed" }).replayedThrough).toBe(
    Number.POSITIVE_INFINITY,
  );
});
