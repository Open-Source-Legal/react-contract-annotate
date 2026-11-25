/**
 * What a format reads from (and reports to) the annotator it renders in.
 * Formats use these hooks rather than the store's atoms, which stay private
 * to the library. Each throws outside an annotator.
 */
import { useAtomValue } from "jotai";
import { useCallback } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";

import { eventCallbacks } from "./callbacks";
import { DOCUMENT_ERROR_MESSAGE } from "./constants";
import { devWarnOnce } from "./devWarn";
import type { InternalAnnotation } from "./normalize";
import { useAnnotatorStore } from "./state/AnnotatorProvider";
import {
  activeHighlightIdAtom,
  annotationActionsSlotAtom,
  annotationsAtom,
  displaySettingsAtom,
  documentStatusAtom,
  editingAtom,
  highlightsAtom,
  rootElementAtom,
  selectedAnnotationIdsAtom,
  selectedRelationsAtom,
  zoomAtom,
} from "./state/atoms";
import type { DisplaySettings, DocumentStatus } from "./state/atoms";
import type {
  Annotation,
  AnnotationLabel,
  AnnotatorCommonProps,
  Highlight,
  Relation,
} from "./types";

/** What a format reports with `useSetDocumentStatus`. */
export type DocumentStatusUpdate = {
  state: DocumentStatus["state"];
  /** Default null. */
  progress?: number | null;
  /** Default null; a generic error is recorded for `"error"` without one. */
  error?: Error | null;
};

/**
 * A stable function that logs `message` with `console.warn` the first time
 * `key` is seen by this instance (two annotators on a page each warn once).
 * Does nothing in production builds.
 */
export function useDevWarnOnce(): (key: string, message: string) => void {
  const store = useAnnotatorStore("useDevWarnOnce");
  return useCallback(
    (key: string, message: string) => devWarnOnce(store, key, message),
    [store]
  );
}

/** The current zoom; 1 is the page at its natural size. */
export function useZoom(): number {
  const store = useAnnotatorStore("useZoom");
  return useAtomValue(zoomAtom, { store });
}

export function useDisplaySettings(): DisplaySettings {
  const store = useAnnotatorStore("useDisplaySettings");
  return useAtomValue(displaySettingsAtom, { store });
}

export function useEditing(): {
  readOnly: boolean;
  activeLabel: AnnotationLabel | null;
} {
  const store = useAnnotatorStore("useEditing");
  return useAtomValue(editingAtom, { store });
}

/** The annotator's root element (its scroll container), once mounted. */
export function useRootElement(): HTMLElement | null {
  const store = useAnnotatorStore("useRootElement");
  return useAtomValue(rootElementAtom, { store });
}

export function useDocumentStatus(): DocumentStatus {
  const store = useAnnotatorStore("useDocumentStatus");
  return useAtomValue(documentStatusAtom, { store });
}

/**
 * Reports the format's loading state. The shell renders the loading / error
 * slots and fires `onDocumentLoad` / `onError` from it. Stable for the life
 * of the instance; a report equal to the current status is not written.
 */
export function useSetDocumentStatus(): (
  status: DocumentStatusUpdate
) => void {
  const store = useAnnotatorStore("useSetDocumentStatus");
  return useCallback(
    ({ state, progress = null, error = null }: DocumentStatusUpdate) => {
      store.set(documentStatusAtom, (prev) => {
        // A failure reported without an error keeps the one already
        // recorded, so repeating the report changes nothing.
        const nextError =
          error ??
          (state !== "error"
            ? null
            : prev.state === "error" && prev.error
              ? prev.error
              : new Error(DOCUMENT_ERROR_MESSAGE));
        return prev.state === state &&
          prev.progress === progress &&
          prev.error === nextError
          ? prev
          : { state, progress, error: nextError };
      });
    },
    [store]
  );
}

export function useSelectedAnnotationIds(): string[] {
  const store = useAnnotatorStore("useSelectedAnnotationIds");
  return useAtomValue(selectedAnnotationIdsAtom, { store });
}

export function useHighlights(): Highlight[] {
  const store = useAnnotatorStore("useHighlights");
  return useAtomValue(highlightsAtom, { store });
}

export function useActiveHighlightId(): string | null {
  const store = useAnnotatorStore("useActiveHighlightId");
  return useAtomValue(activeHighlightIdAtom, { store });
}

/**
 * Every annotation of the document, normalised, whatever the display filters
 * say; `useVisibleAnnotations` is what to draw.
 */
export function useAllAnnotations(): InternalAnnotation[] {
  const store = useAnnotatorStore("useAllAnnotations");
  return useAtomValue(annotationsAtom, { store });
}

/** The relations named by `selectedRelationIds` that exist, in that order. */
export function useSelectedRelations(): Relation[] {
  const store = useAnnotatorStore("useSelectedRelations");
  return useAtomValue(selectedRelationsAtom, { store });
}

/** The host's `renderAnnotationActions` slot; undefined when not supplied. */
export function useRenderAnnotationActions(): AnnotatorCommonProps["renderAnnotationActions"] {
  const store = useAnnotatorStore("useRenderAnnotationActions");
  return useAtomValue(annotationActionsSlotAtom, { store }).render;
}

/**
 * A stable function a format calls for every click on an annotation that was
 * not a drag, with the host's own annotation object (`source`). Forwards to
 * `onAnnotationClick`, read when it is called.
 */
export function useOnAnnotationClick(): (
  annotation: Annotation,
  event: ReactMouseEvent
) => void {
  const store = useAnnotatorStore("useOnAnnotationClick");
  return useCallback(
    (annotation: Annotation, event: ReactMouseEvent) =>
      eventCallbacks(store).onAnnotationClick?.(annotation, event),
    [store]
  );
}

/**
 * A stable function a format calls when the pointer enters an annotation
 * (with the host's own object) or leaves it (`null`). Forwards to
 * `onAnnotationHover`, read when it is called.
 */
export function useOnAnnotationHover(): (annotation: Annotation | null) => void {
  const store = useAnnotatorStore("useOnAnnotationHover");
  return useCallback(
    (annotation: Annotation | null) =>
      eventCallbacks(store).onAnnotationHover?.(annotation),
    [store]
  );
}
