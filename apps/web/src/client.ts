import { makeClotsClient, type Store } from "@clots/client-runtime";
import { useSyncExternalStore } from "react";

/** The one connection of this page. The clots server serves the page, so the origin is the server. */
export const client = makeClotsClient(window.location.origin);

/** Reads a client-runtime store and renders again when it changes. */
export const useStore = <T>(store: Store<T>): T => useSyncExternalStore(store.subscribe, store.get);
