/**
 * The pending text selection: what happens when a format reports that the
 * user has finished selecting text, and the actions that act on the result.
 *
 * `useCompleteSelection` is the format's side. It records the selection as
 * pending in the store, tells the host through `onTextSelect`, then, unless
 * the host already dealt with it, applies exactly one outcome:
 *
 * 1. `renderSelectionMenu` is supplied: the selection stays pending and
 *    `SelectionMenuHost` renders the slot.
 * 2. No slot, not `readOnly` and an `activeLabel`: it is committed at once.
 * 3. Otherwise it stays pending until the host clears it, the user presses
 *    Escape or a newer selection replaces it.
 *
 * Committing hands the draft to `onCreateAnnotation`; the library never adds
 * it to the annotations itself.
 */
import { atom, useAtomValue } from "jotai";
import { useCallback, useEffect, useLayoutEffect, useMemo } from "react";

import { ESCAPE_KEY } from "./constants";
import { devWarnOnce } from "./devWarn";
import { useAnnotatorStore } from "./state/AnnotatorProvider";
import type { AnnotatorStore } from "./state/AnnotatorProvider";
import {
  editingAtom,
  pendingSelectionAtom,
  rootElementAtom,
} from "./state/atoms";
import type {
  AnnotationDraft,
  AnnotatorCommonProps,
  AnnotatorHandle,
  PendingActions,
  PendingSelection,
} from "./types";

/** The common props the pending selection calls back into. */
type SelectionCallbacks = Pick<
  AnnotatorCommonProps,
  "onTextSelect" | "onCreateAnnotation" | "onError" | "renderSelectionMenu"
>;

/**
 * The latest callbacks, in a holder of the instance's own: formats complete
 * selections without access to the props, and a callback must be read when
 * it is needed, not when it was last rendered. A derived atom without
 * dependencies is computed once per store and then kept (the same trick as
 * `devWarn.ts`), so each instance gets a holder of its own.
 */
const callbacksAtom = atom(() => ({ current: {} as SelectionCallbacks }));

/** Whether a selection is pending; unlike the selection, it rarely changes. */
const hasPendingSelectionAtom = atom(
  (get) => get(pendingSelectionAtom) !== null
);

/** The actions of a pending selection, without the selection itself. */
type PendingControls = Pick<PendingActions, "commit" | "clear" | "copyText">;

/** Makes the shell's current callbacks readable at event time. */
export function useSyncSelectionCallbacks(callbacks: SelectionCallbacks): void {
  const store = useAnnotatorStore("useSyncSelectionCallbacks");
  const { onTextSelect, onCreateAnnotation, onError, renderSelectionMenu } =
    callbacks;
  useLayoutEffect(() => {
    store.get(callbacksAtom).current = {
      onTextSelect,
      onCreateAnnotation,
      onError,
      renderSelectionMenu,
    };
  }, [store, onTextSelect, onCreateAnnotation, onError, renderSelectionMenu]);
}

/**
 * A rejected `onCreateAnnotation` promise goes to `onError`. The library's
 * catch is also what keeps it from being an unhandled rejection, so without
 * an `onError` the failure is at least warned about in development.
 */
function reportCreateFailure(store: AnnotatorStore, reason: unknown): void {
  const error = reason instanceof Error ? reason : new Error(String(reason));
  const { onError } = store.get(callbacksAtom).current;
  if (onError) {
    onError(error);
    return;
  }
  devWarnOnce(
    store,
    "create-annotation-rejected",
    "onCreateAnnotation returned a promise that rejected, and no onError " +
      `callback was supplied to report it to: ${error.message}`
  );
}

/**
 * The actions on the pending selection. With `bound` they act only while
 * that very selection is still the pending one, and do nothing once a newer
 * one has replaced it; without, on whichever selection is pending when they
 * are called.
 */
function createControls(
  store: AnnotatorStore,
  bound?: PendingSelection
): PendingControls {
  const target = (): PendingSelection | null => {
    const current = store.get(pendingSelectionAtom);
    return bound === undefined || current === bound ? current : null;
  };

  return {
    commit(label) {
      const pending = target();
      const { readOnly, activeLabel } = store.get(editingAtom);
      if (!pending || readOnly) return;
      // The draft only: the anchor is not part of what the host persists.
      const draft: AnnotationDraft = {
        json: pending.json,
        rawText: pending.rawText,
        page: pending.page,
        annotationLabel: label ?? activeLabel ?? null,
      };
      // Cleared first and not awaited, so the selection is gone whether the
      // callback returns, rejects or never settles.
      store.set(pendingSelectionAtom, null);
      const result = store.get(callbacksAtom).current.onCreateAnnotation?.(
        draft
      );
      void Promise.resolve(result).catch((reason: unknown) =>
        reportCreateFailure(store, reason)
      );
    },

    clear() {
      if (target()) store.set(pendingSelectionAtom, null);
    },

    async copyText() {
      const pending = target();
      const clipboard =
        typeof navigator === "undefined" ? undefined : navigator.clipboard;
      if (!pending || !clipboard) return false;
      try {
        await clipboard.writeText(pending.rawText);
        return true;
      } catch {
        return false;
      }
    },
  };
}

function completeSelection(
  store: AnnotatorStore,
  draft: AnnotationDraft,
  anchor: { x: number; y: number }
): void {
  const pending: PendingSelection = {
    json: draft.json,
    rawText: draft.rawText,
    page: draft.page,
    annotationLabel: draft.annotationLabel,
    anchor: { x: anchor.x, y: anchor.y },
  };
  store.set(pendingSelectionAtom, pending);

  // Bound to this selection: if the host commits, clears or replaces it from
  // `onTextSelect`, the commit of outcome 2 below finds it gone and does
  // nothing, so the host's own handling is never doubled.
  const controls = createControls(store, pending);
  store.get(callbacksAtom).current.onTextSelect?.(pending, {
    pending,
    anchor: pending.anchor,
    ...controls,
  });

  if (store.get(callbacksAtom).current.renderSelectionMenu) return; // outcome 1
  const { readOnly, activeLabel } = store.get(editingAtom);
  if (!readOnly && activeLabel) controls.commit(); // outcome 2
  // Outcome 3: it stays pending.
}

/**
 * For formats. Returns a stable function to call when the user finishes
 * selecting text, with the draft and the viewport point (`clientX` /
 * `clientY` coordinates) the selection menu should open at. Never re-renders
 * its caller.
 */
export function useCompleteSelection(): (
  draft: AnnotationDraft,
  anchor: { x: number; y: number }
) => void {
  const store = useAnnotatorStore("useCompleteSelection");
  return useCallback(
    (draft, anchor) => completeSelection(store, draft, anchor),
    [store]
  );
}

/** The pending selection, or null. For formats that paint it. */
export function usePendingSelection(): PendingSelection | null {
  const store = useAnnotatorStore("usePendingSelection");
  return useAtomValue(pendingSelectionAtom, { store });
}

/**
 * Stable actions on whichever selection is pending when they are called;
 * without one, `commit` and `clear` do nothing and `copyText` resolves false.
 * `commit` does nothing while the annotator is `readOnly`. `copyText` writes
 * the selection's text to the clipboard and resolves whether it did; it never
 * rejects.
 */
export function usePendingActions(): PendingControls {
  const store = useAnnotatorStore("usePendingActions");
  return useMemo(() => createControls(store), [store]);
}

/** The pending-selection methods of the imperative handle. */
export function pendingHandleMethods(
  store: AnnotatorStore
): Pick<
  AnnotatorHandle,
  "getPendingSelection" | "commitPendingSelection" | "clearPendingSelection"
> {
  const controls = createControls(store);
  return {
    getPendingSelection: () => store.get(pendingSelectionAtom),
    commitPendingSelection: (label) => controls.commit(label),
    clearPendingSelection: () => controls.clear(),
  };
}

/**
 * Escape clears a pending selection. It is heard on the instance root
 * (focusable, so a click inside the document focuses it) and, only while a
 * selection is pending, on the window, which covers focus elsewhere.
 */
export function useClearPendingOnEscape(): void {
  const store = useAnnotatorStore("useClearPendingOnEscape");
  const root = useAtomValue(rootElementAtom, { store });
  const hasPending = useAtomValue(hasPendingSelectionAtom, { store });

  const onKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (event.key === ESCAPE_KEY) store.set(pendingSelectionAtom, null);
    },
    [store]
  );

  useEffect(() => {
    if (!root) return;
    root.addEventListener("keydown", onKeyDown);
    return () => root.removeEventListener("keydown", onKeyDown);
  }, [root, onKeyDown]);

  useEffect(() => {
    if (!hasPending) return;
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [hasPending, onKeyDown]);
}
