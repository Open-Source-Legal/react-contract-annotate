/**
 * Scroll requests. At most one request is in flight per instance: the shell
 * (or the handle) raises it, the format scrolls and completes it. A new
 * request settles the previous one with `false`. A bounded request settles
 * `false` after `SCROLL_SETTLE_TIMEOUT_MS`; an unbounded one waits until it is
 * completed or superseded.
 */
import { atom, useAtomValue } from "jotai";
import { useCallback, useMemo } from "react";

import { DEFAULT_SCROLL_BEHAVIOR, SCROLL_SETTLE_TIMEOUT_MS } from "./constants";
import { useAnnotatorStore } from "./state/AnnotatorProvider";
import type { AnnotatorStore } from "./state/AnnotatorProvider";

export type ScrollTarget =
  | { kind: "annotation"; id: string }
  | { kind: "highlight"; id: string };

export interface ScrollRequest {
  /** Increases with every request of the instance. */
  seq: number;
  target: ScrollTarget;
  behavior: ScrollBehavior;
  /** True when the request gives up after `SCROLL_SETTLE_TIMEOUT_MS`. */
  bounded: boolean;
}

export type ScrollRequestOptions = {
  /** Default `"smooth"`. */
  behavior?: ScrollBehavior;
  /** Default false. */
  bounded?: boolean;
};

type InFlight = {
  request: ScrollRequest;
  resolve: (ok: boolean) => void;
  timer: ReturnType<typeof setTimeout> | undefined;
};

/** The request in flight with the means to settle it. */
const inFlightAtom = atom<InFlight | null>(null);
/** The last sequence number handed out. */
const lastSeqAtom = atom(0);
/** What formats see: the request in flight, without its settle plumbing. */
const scrollRequestAtom = atom((get) => get(inFlightAtom)?.request ?? null);

/** Settles the request `seq` if it is still in flight; otherwise nothing. */
function settle(store: AnnotatorStore, seq: number, ok: boolean): void {
  const inFlight = store.get(inFlightAtom);
  if (!inFlight || inFlight.request.seq !== seq) return;
  clearTimeout(inFlight.timer);
  store.set(inFlightAtom, null);
  inFlight.resolve(ok);
}

function raise(
  store: AnnotatorStore,
  target: ScrollTarget,
  { behavior = DEFAULT_SCROLL_BEHAVIOR, bounded = false }: ScrollRequestOptions
): Promise<boolean> {
  cancelScrollRequest(store);
  const seq = store.get(lastSeqAtom) + 1;
  store.set(lastSeqAtom, seq);
  const request: ScrollRequest = { seq, target, behavior, bounded };
  return new Promise<boolean>((resolve) => {
    const timer = bounded
      ? setTimeout(() => settle(store, seq, false), SCROLL_SETTLE_TIMEOUT_MS)
      : undefined;
    store.set(inFlightAtom, { request, resolve, timer });
  });
}

/** Settles the request in flight, if any, with `false`. */
export function cancelScrollRequest(store: AnnotatorStore): void {
  const inFlight = store.get(inFlightAtom);
  if (inFlight) settle(store, inFlight.request.seq, false);
}

/**
 * Raises a scroll request. The promise resolves with the format's result, or
 * `false` when superseded, cancelled or (bounded only) timed out.
 */
export function useRequestScroll(): (
  target: ScrollTarget,
  opts?: ScrollRequestOptions
) => Promise<boolean> {
  const store = useAnnotatorStore("useRequestScroll");
  return useCallback(
    (target: ScrollTarget, opts: ScrollRequestOptions = {}) =>
      raise(store, target, opts),
    [store]
  );
}

/**
 * The request in flight, for the format to carry out, and `complete` to
 * report the outcome. Completing a request that is no longer current does
 * nothing.
 */
export function useScrollRequest(): {
  request: ScrollRequest | null;
  complete(seq: number, ok: boolean): void;
} {
  const store = useAnnotatorStore("useScrollRequest");
  const request = useAtomValue(scrollRequestAtom, { store });
  const complete = useCallback(
    (seq: number, ok: boolean) => settle(store, seq, ok),
    [store]
  );
  return useMemo(() => ({ request, complete }), [request, complete]);
}
