/**
 * The common props the library calls at event time: when the user finishes a
 * selection, clicks or hovers an annotation, or opens a link. A callback must
 * be read when it is needed, not when it was last rendered, and the code that
 * calls it (a format, the pending selection) has no access to the props, so
 * the shell keeps the latest ones in a holder of the instance's own.
 */
import { atom } from "jotai";
import { useLayoutEffect } from "react";

import { useAnnotatorStore } from "./state/AnnotatorProvider";
import type { AnnotatorStore } from "./state/AnnotatorProvider";
import type { AnnotatorCommonProps } from "./types";

export type EventCallbacks = Pick<
  AnnotatorCommonProps,
  | "onTextSelect"
  | "onCreateAnnotation"
  | "onError"
  | "renderSelectionMenu"
  | "onAnnotationClick"
  | "onAnnotationHover"
  | "onOpenLink"
>;

/**
 * A derived atom without dependencies is computed once per store and then
 * kept (the same trick as `devWarn.ts`), so each instance gets a holder of
 * its own.
 */
const callbacksAtom = atom(() => ({ current: {} as EventCallbacks }));

/** Makes the shell's current callbacks readable at event time. */
export function useSyncEventCallbacks(callbacks: EventCallbacks): void {
  const store = useAnnotatorStore("useSyncEventCallbacks");
  const {
    onTextSelect,
    onCreateAnnotation,
    onError,
    renderSelectionMenu,
    onAnnotationClick,
    onAnnotationHover,
    onOpenLink,
  } = callbacks;
  useLayoutEffect(() => {
    store.get(callbacksAtom).current = {
      onTextSelect,
      onCreateAnnotation,
      onError,
      renderSelectionMenu,
      onAnnotationClick,
      onAnnotationHover,
      onOpenLink,
    };
  }, [
    store,
    onTextSelect,
    onCreateAnnotation,
    onError,
    renderSelectionMenu,
    onAnnotationClick,
    onAnnotationHover,
    onOpenLink,
  ]);
}

/** The callbacks the shell last rendered with. */
export function eventCallbacks(store: AnnotatorStore): EventCallbacks {
  return store.get(callbacksAtom).current;
}
