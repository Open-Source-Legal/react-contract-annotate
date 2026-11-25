import { atom } from "jotai";
import type { createStore } from "jotai";

type Store = ReturnType<typeof createStore>;

// The keys already warned about live in the instance's own store, so two
// viewers on one page each warn once and nothing is shared at module level.
// The derived atom has no dependencies, so the store computes the set on the
// first read and keeps handing back that same set.
const warnedKeysAtom = atom(() => new Set<string>());

function isProduction(): boolean {
  try {
    // Written out in full so bundlers can replace it statically. Where there
    // is no bundler and no `process`, development is assumed.
    return process.env.NODE_ENV === "production";
  } catch {
    return false;
  }
}

/**
 * Logs `message` with `console.warn` the first time `key` is seen on `store`.
 * Does nothing in production builds.
 */
export function devWarnOnce(store: Store, key: string, message: string): void {
  if (isProduction()) return;
  const warned = store.get(warnedKeysAtom);
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(message);
}
