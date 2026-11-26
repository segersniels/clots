import { makeStore } from "@clots/client-runtime";
import type { BotId } from "@clots/contracts";

import { client } from "./client.ts";

/** A file of a message that the operator sent. An image has `previewUrl`, its local copy, until the server's copy shows. */
export interface SentFile {
  readonly name: string;
  readonly mediaType: string;
  readonly size: number;
  readonly previewUrl: string | undefined;
}

/**
 * A message that the operator sent. The thread shows it at once, after the server's messages, and
 * drops it when the server's copy with the same id arrives.
 */
export interface SentMessage {
  readonly id: string;
  readonly botId: BotId;
  readonly text: string;
  readonly createdAt: number;
  readonly files: ReadonlyArray<SentFile>;
  /** Is `true` when the thread has the server's copy. Only an image preview that is still on screen then keeps the message here. */
  readonly stored: boolean;
}

/**
 * Keeps the sent messages until the server has them and their previews are off the screen. The
 * list lives outside the thread view, so a sent message survives a move to another bot and back.
 */
export const sentMessages = makeStore<ReadonlyArray<SentMessage>>([]);

export const addSentMessage = (message: SentMessage) =>
  sentMessages.set((messages) => [...messages, message]);

/** Removes a message whose send failed. Its files go back to the composer, so their previews stay. */
export const dropSentMessage = (id: string) =>
  sentMessages.set((messages) => messages.filter((message) => message.id !== id));

/** Forgets the stored messages whose previews are all gone. */
const forgetShownMessages = () =>
  sentMessages.set((messages) =>
    messages.filter(
      (message) => !message.stored || message.files.some((file) => file.previewUrl !== undefined),
    ),
  );

/** Marks a sent message as stored as soon as the thread has the server's copy. */
export const confirmSentMessage = (botId: BotId, id: string) => {
  const thread = client.thread(botId);

  const check = () => {
    if (!thread.get().messages.some((message) => message.id === id)) {
      return;
    }

    stopWatching();
    sentMessages.set((messages) =>
      messages.map((message) => (message.id === id ? { ...message, stored: true } : message)),
    );
    forgetShownMessages();
  };

  const stopWatching = thread.subscribe(check);
  check();
};

/** Lets go of the preview of one image of a sent message, because the server's copy of the image has loaded. */
export const releasePreview = (id: string, fileIndex: number) => {
  const previewUrl = sentMessages.get().find((message) => message.id === id)?.files[
    fileIndex
  ]?.previewUrl;

  if (previewUrl === undefined) {
    return;
  }

  sentMessages.set((messages) =>
    messages.map((message) =>
      message.id === id
        ? {
            ...message,
            files: message.files.map((file, index) =>
              index === fileIndex ? { ...file, previewUrl: undefined } : file,
            ),
          }
        : message,
    ),
  );
  URL.revokeObjectURL(previewUrl);
  forgetShownMessages();
};
