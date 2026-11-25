/**
 * Gives one annotator instance its own Jotai store. Everything below the
 * provider reads and writes that store only, so two instances on a page never
 * share state.
 */
import { createStore, Provider, useStore } from "jotai";
import { useId, useState } from "react";
import type { ReactNode } from "react";

import { instanceIdAtom } from "./atoms";

export type AnnotatorStore = ReturnType<typeof createStore>;

export function AnnotatorProvider({ children }: { children: ReactNode }) {
  const instanceId = useId();
  // A lazy `useState` initialiser, not `useMemo`: React may discard a memoised
  // value, and a store must live exactly as long as the mount.
  const [store] = useState(() => {
    const created = createStore();
    created.set(instanceIdAtom, instanceId);
    return created;
  });
  return <Provider store={store}>{children}</Provider>;
}

/**
 * The store of the nearest annotator. Outside one, Jotai would silently hand
 * back its default store, shared by everything on the page; this throws
 * instead. `hookName` names the caller in the error.
 */
export function useAnnotatorStore(hookName: string): AnnotatorStore {
  const store = useStore();
  if (store.get(instanceIdAtom) === "") {
    throw new Error(
      `${hookName} must be used inside an annotator: render it as a ` +
        "descendant of AnnotatorShell (or AnnotatorProvider)."
    );
  }
  return store;
}
