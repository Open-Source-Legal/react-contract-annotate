/**
 * Gives one annotator instance its own Jotai store. Everything below the
 * provider reads and writes that store only, so two instances on a page never
 * share state.
 */
import { createStore, Provider } from "jotai";
import { useId, useState } from "react";
import type { ReactNode } from "react";

import { instanceIdAtom } from "./atoms";

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
