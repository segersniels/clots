import type { Message, ThreadEvent, ThreadLiveState } from "@clots/contracts";

export interface ThreadState {
  readonly messages: ReadonlyArray<Message>;
  readonly live: ThreadLiveState;
  /** The replay cursor. A new subscription asks for the messages after this sequence. */
  readonly lastSequence: number;
  /** Is `false` until the server sent the live state, which follows the replay. */
  readonly synced: boolean;
}

export const emptyThread: ThreadState = {
  messages: [],
  live: { status: "idle", steps: [], streamingText: "", approvals: [], handoff: null, tasks: [] },
  lastSequence: 0,
  synced: false,
};

/** Applies one server event to the thread state. */
export const applyThreadEvent = (state: ThreadState, event: ThreadEvent): ThreadState => {
  if (event._tag === "Delta") {
    return { ...state, live: { ...state.live, streamingText: state.live.streamingText + event.text } };
  }

  if (event._tag === "Live") return { ...state, live: event.state, synced: true };

  // A resumed subscription can replay a message that this client already has.
  if (event.message.sequence <= state.lastSequence) return state;

  return {
    ...state,
    messages: [...state.messages, event.message],
    lastSequence: event.message.sequence,
    // The stored message replaces the text that streamed in for it.
    live: event.message.role === "assistant" ? { ...state.live, streamingText: "" } : state.live,
  };
};
