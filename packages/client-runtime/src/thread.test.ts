import type { BotId, Message } from "@clots/contracts";
import { expect, test } from "bun:test";

import { applyThreadEvent, emptyThread } from "./thread.ts";

const message = (sequence: number, role: Message["role"], text: string): Message => ({
  id: `m${sequence}`,
  botId: "bot" as BotId,
  sequence,
  role,
  text,
  createdAt: sequence,
});

test("a replayed message that the client already has does not appear twice", () => {
  const first = applyThreadEvent(emptyThread, { _tag: "Message", message: message(1, "user", "hi") });
  const replayed = applyThreadEvent(first, { _tag: "Message", message: message(1, "user", "hi") });

  expect(replayed.messages).toHaveLength(1);
  expect(replayed.lastSequence).toBe(1);
});

test("the stored assistant message replaces the streamed text", () => {
  const streaming = [
    { _tag: "Delta", text: "Hel" } as const,
    { _tag: "Delta", text: "lo" } as const,
  ].reduce(applyThreadEvent, emptyThread);

  expect(streaming.live.streamingText).toBe("Hello");

  const stored = applyThreadEvent(streaming, { _tag: "Message", message: message(2, "assistant", "Hello") });

  expect(stored.live.streamingText).toBe("");
  expect(stored.messages.map((item) => item.text)).toEqual(["Hello"]);
});

test("the live state marks the thread as synced", () => {
  const synced = applyThreadEvent(emptyThread, { _tag: "Live", state: { ...emptyThread.live, status: "working" } });

  expect(synced.synced).toBe(true);
  expect(synced.live.status).toBe("working");
});
