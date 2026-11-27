/**
 * Gives one annotator instance its own Jotai store. Everything below the
 * provider reads and writes that store only, so two instances on a page never
 * share state.
 *
 * The store travels in a context of the library's own, not in Jotai's
 * `<Provider>`, and every hook names it explicitly (`{ store }`). A host
 * that uses Jotai keeps its own Jotai context below the annotator: content it
 * renders there (the slots, action icons) reads the host's atoms, not this
 * store. `scripts/check-imports.mjs` keeps it that way.
 */
import { createStore } from "jotai";
import { createContext, useContext, useId, useState } from "react";
import type { ReactNode } from "react";

import { instanceIdAtom } from "./atoms";

export type AnnotatorStore = ReturnType<typeof createStore>;

const AnnotatorStoreContext = createContext<AnnotatorStore | null>(null);

export function AnnotatorProvider({ children }: { children: ReactNode }) {
  const instanceId = useId();
  // A lazy `useState` initialiser, not `useMemo`: React may discard a memoised
  // value, and a store must live exactly as long as the mount.
  const [store] = useState(() => {
    const created = createStore();
    created.set(instanceIdAtom, instanceId);
    return created;
  });
  return (
    <AnnotatorStoreContext.Provider value={store}>
      {children}
    </AnnotatorStoreContext.Provider>
  );
}

/**
 * The store of the nearest annotator; throws outside one. `hookName` names
 * the caller in the error.
 */
export function useAnnotatorStore(hookName: string): AnnotatorStore {
  const store = useContext(AnnotatorStoreContext);
  if (store === null) {
    throw new Error(
      `${hookName} must be used inside an annotator: render it as a ` +
        "descendant of AnnotatorShell (or AnnotatorProvider)."
    );
  }
  return store;
}
