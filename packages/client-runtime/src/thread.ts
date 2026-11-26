import type { Message, ThreadEvent, ThreadLiveState } from "@clots/contracts";

export interface ThreadState {
  readonly messages: ReadonlyArray<Message>;
  readonly live: ThreadLiveState;
  /** The replay cursor. A new subscription asks for the messages after this sequence. */
  readonly lastSequence: number;
  /** Is `false` until the server sent the live state, which follows the replay. */
  readonly synced: boolean;
  /**
   * The last message of the replay of the current subscription. Later messages arrived live. It is
   * infinite while a replay runs, because every message then is a missed one.
   */
  readonly replayedThrough: number;
}

/** Tells the thread that a new subscription starts, so the messages before its live state are a replay. */
export type ThreadUpdate = ThreadEvent | { readonly _tag: "Subscribed" };

export const emptyThread: ThreadState = {
  messages: [],
  live: { status: "idle", steps: [], approvals: [], handoff: null, loginRequest: null, tasks: [] },
  lastSequence: 0,
  synced: false,
  replayedThrough: Number.POSITIVE_INFINITY,
};

/** Applies one server event, or the start of a subscription, to the thread state. */
export const applyThreadEvent = (state: ThreadState, event: ThreadUpdate): ThreadState => {
  if (event._tag === "Subscribed") {
    return { ...state, replayedThrough: Number.POSITIVE_INFINITY };
  }

  // The first live state of a subscription ends its replay. Later live states do not move the end.
  if (event._tag === "Live") {
    const replayedThrough =
      state.replayedThrough === Number.POSITIVE_INFINITY
        ? state.lastSequence
        : state.replayedThrough;

    return { ...state, live: event.state, synced: true, replayedThrough };
  }

  // A resumed subscription can replay a message that this client already has.
  if (event.message.sequence <= state.lastSequence) {
    return state;
  }

  return {
    ...state,
    messages: [...state.messages, event.message],
    lastSequence: event.message.sequence,
  };
};

/**
 * Finds the messages that the operator sent and the server has not stored yet. The stored copy has
 * the id of the sent message, so it takes the sent message's place in the render in which it arrives.
 */
export const unconfirmedMessages = <T extends { readonly id: string }>(
  sent: ReadonlyArray<T>,
  messages: ReadonlyArray<Message>,
): ReadonlyArray<T> => {
  if (sent.length === 0) {
    return sent;
  }

  const stored = new Set(messages.map((message) => message.id));

  return sent.filter((message) => !stored.has(message.id));
};
