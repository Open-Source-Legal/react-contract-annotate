/**
 * Bridges a value the host may or may not control into the instance store.
 *
 * Three values are bridged (`ControllableKey`). For each, a value prop that is
 * not `undefined` makes the key controlled: the prop is written into the
 * matching atom and writes made through `useSetControllable` only notify the
 * host, whose next render applies the value. With no value prop the atom is
 * the source of truth and the callback is a notification.
 *
 * Which keys are controlled, and where to notify, lives in the instance store
 * so renderers and the imperative handle can write through
 * `useSetControllable` without knowing about props.
 */
import { atom } from "jotai";
import type { PrimitiveAtom } from "jotai";
import { useCallback, useLayoutEffect, useMemo, useRef } from "react";

import type { ChangeInfo } from "../types";
import { useAnnotatorStore } from "./AnnotatorProvider";
import type { AnnotatorStore } from "./AnnotatorProvider";
import {
  activeHighlightIdAtom,
  selectedAnnotationIdsAtom,
  zoomAtom,
} from "./atoms";

export type ControllableKey = "selection" | "zoom" | "activeHighlight";

const VALUE_ATOMS = Object.freeze({
  selection: selectedAnnotationIdsAtom,
  zoom: zoomAtom,
  activeHighlight: activeHighlightIdAtom,
});

/** The atom behind a key. `T` is the caller's promise about its value type. */
function valueAtom<T>(key: ControllableKey): PrimitiveAtom<T> {
  return VALUE_ATOMS[key] as unknown as PrimitiveAtom<T>;
}

type Bridge = {
  controlled: boolean;
  notify: (next: unknown, info: ChangeInfo) => void;
};
type PerKey<V> = Readonly<Partial<Record<ControllableKey, V>>>;

/** Where each bridged key currently reports to, if a hook has claimed it. */
const bridgesAtom = atom<PerKey<Bridge>>(Object.freeze({}));

/** One write made with `{ source: "user" }`, numbered per key from 1. */
type UserWrite = { readonly value: unknown; readonly version: number };
/** The last user write, per key. */
const lastUserWritesAtom = atom<PerKey<UserWrite>>(Object.freeze({}));

type Store = AnnotatorStore;

function setBridge(store: Store, key: ControllableKey, bridge: Bridge) {
  store.set(bridgesAtom, (prev) => {
    const current = prev[key];
    return current?.controlled === bridge.controlled &&
      current.notify === bridge.notify
      ? prev
      : { ...prev, [key]: bridge };
  });
}

function clearBridge(store: Store, key: ControllableKey, bridge: Bridge) {
  store.set(bridgesAtom, (prev) => {
    if (prev[key]?.notify !== bridge.notify) return prev;
    const next = { ...prev };
    delete next[key];
    return next;
  });
}

export interface ControllableOptions<T> {
  /** Controls the key when not `undefined` (`null` is a controlled value). */
  value: T | undefined;
  /** Initial value when uncontrolled; later changes are ignored. */
  defaultValue: T;
  /** Called with every write made through `useSetControllable`. */
  onChange?: (next: T, info: ChangeInfo) => void;
  /** Decides whether a new `value` differs from the atom. Default `Object.is`. */
  equals?: (a: T, b: T) => boolean;
}

/**
 * Call once per key, from the component that receives the props, under an
 * `AnnotatorProvider`. It seeds its atom during the first render, so it must
 * be mounted exactly once per provider, in or above the component that
 * renders the subscribers, and never remounted under a live provider.
 */
export function useControllable<T>(
  key: ControllableKey,
  { value, defaultValue, onChange, equals = Object.is }: ControllableOptions<T>
): void {
  const store = useAnnotatorStore("useControllable");
  const target = valueAtom<T>(key);
  const controlled = value !== undefined;

  // Callbacks are read through refs so an inline `onChange` or `equals` never
  // re-runs an effect, and `notify` stays the same function for the lifetime
  // of the hook.
  const onChangeRef = useRef(onChange);
  const equalsRef = useRef(equals);
  const notify = useCallback(
    (next: T, info: ChangeInfo) => onChangeRef.current?.(next, info),
    []
  );
  const bridge: Bridge = useMemo(
    () => ({ controlled, notify: notify as Bridge["notify"] }),
    [controlled, notify]
  );

  // First render only: seed the atom and claim the key before anything below
  // renders or runs an effect. A child's mount effect that calls the setter
  // runs before this component's effects, and must already see the right
  // controlled-ness. Nothing subscribes to the atom yet, so writing now makes
  // no component update; it also spares the first paint a stale zoom or
  // selection. The writes are idempotent, so a double render is harmless.
  const seeded = useRef(false);
  if (!seeded.current) {
    seeded.current = true;
    const initial = value !== undefined ? value : defaultValue;
    if (!Object.is(store.get(target), initial)) store.set(target, initial);
    setBridge(store, key, bridge);
  }

  useLayoutEffect(() => {
    onChangeRef.current = onChange;
    equalsRef.current = equals;
  });

  useLayoutEffect(() => {
    setBridge(store, key, bridge);
    return () => clearBridge(store, key, bridge);
  }, [store, key, bridge]);

  // A new controlled value is written only when it differs by `equals`, so an
  // equal-but-new array from the host keeps the atom's reference (and its
  // subscribers asleep).
  useLayoutEffect(() => {
    if (value === undefined) return;
    if (!equalsRef.current(store.get(target), value)) store.set(target, value);
  }, [store, target, value]);
}

/**
 * The setter renderers and the handle use. Uncontrolled keys write the atom;
 * controlled keys leave it for the host's next render. Either way the host's
 * `onChange` is told. Stable for the life of the instance.
 */
export function useSetControllable<T>(
  key: ControllableKey
): (next: T, info: ChangeInfo) => void {
  const store = useAnnotatorStore("useSetControllable");
  return useCallback(
    (next, info) => {
      const bridge = store.get(bridgesAtom)[key];
      if (info.source === "user") {
        store.set(lastUserWritesAtom, (prev) => ({
          ...prev,
          [key]: { value: next, version: (prev[key]?.version ?? 0) + 1 },
        }));
      }
      if (!bridge?.controlled) store.set(valueAtom<T>(key), next);
      bridge?.notify(next, info);
    },
    [store, key]
  );
}

/**
 * Read-only ref-like view of the last value written with
 * `{ source: "user" }` (undefined if none). It lets the host's echo of a user
 * change, arriving back as a prop, be told apart from an external change.
 * `version` counts the user writes of the key (0 if none), so a caller can
 * tell a new user write from one it has already seen even when the value is
 * the same.
 */
export function useLastUserValue<T>(key: ControllableKey): {
  readonly current: T | undefined;
  readonly version: number;
} {
  const store = useAnnotatorStore("useLastUserValue");
  return useMemo(
    () => ({
      get current() {
        return store.get(lastUserWritesAtom)[key]?.value as T | undefined;
      },
      get version() {
        return store.get(lastUserWritesAtom)[key]?.version ?? 0;
      },
    }),
    [store, key]
  );
}
