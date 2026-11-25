/**
 * What a format reads from (and reports to) the annotator it renders in.
 * Formats use these hooks rather than the store's atoms, which stay private
 * to the library. Each throws outside an annotator.
 */
import { useAtomValue } from "jotai";
import { useCallback } from "react";

import { DOCUMENT_ERROR_MESSAGE } from "./constants";
import { useAnnotatorStore } from "./state/AnnotatorProvider";
import {
  activeHighlightIdAtom,
  displaySettingsAtom,
  documentStatusAtom,
  editingAtom,
  highlightsAtom,
  rootElementAtom,
  selectedAnnotationIdsAtom,
  zoomAtom,
} from "./state/atoms";
import type { DisplaySettings, DocumentStatus } from "./state/atoms";
import type { AnnotationLabel, Highlight } from "./types";

/** What a format reports with `useSetDocumentStatus`. */
export type DocumentStatusUpdate = {
  state: DocumentStatus["state"];
  /** Default null. */
  progress?: number | null;
  /** Default null; a generic error is recorded for `"error"` without one. */
  error?: Error | null;
};

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
