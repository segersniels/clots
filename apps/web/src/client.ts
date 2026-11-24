import { makeClotsClient, type Store } from "@clots/client-runtime";
import { useSyncExternalStore } from "react";

/** The one connection of this page. The clots server serves the page, so the origin is the server. */
export const client = makeClotsClient(window.location.origin);

/** Ignores the changes of a store, so the store lets go of its server stream while nobody listens. */
const ignoreChanges = () => () => {};

/** Reads a client-runtime store and renders again when it changes. An inactive view shows the last value and does not listen. */
export const useStore = <T>(store: Store<T>, active = true): T => useSyncExternalStore(active ? store.subscribe : ignoreChanges, store.get);
