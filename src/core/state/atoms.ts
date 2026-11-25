/**
 * The atoms of one annotator instance. They are defined once at module level
 * (that is how Jotai works) but never read or written there: every component
 * reaches them through the `<Provider store>` that `AnnotatorProvider`
 * creates, so each instance has its own values.
 *
 * Initial values are frozen. A store starts from the shared initial value, so
 * one that could be mutated in place would leak between instances; frozen, an
 * attempt to do so throws instead.
 */
import { atom } from "jotai";

import type { InternalAnnotation } from "../normalize";
import type {
  AnnotationLabel,
  Highlight,
  LabelDisplay,
  PendingSelection,
  Relation,
} from "../types";

/** A fresh frozen empty list typed as `T[]`, for use as an initial value. */
function frozenEmptyList<T>(): T[] {
  return Object.freeze([]) as unknown as T[];
}

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

/** Every annotation of the document, normalised. */
export const annotationsAtom = atom<InternalAnnotation[]>(
  frozenEmptyList<InternalAnnotation>()
);
export const relationsAtom = atom<Relation[]>(frozenEmptyList<Relation>());
export const highlightsAtom = atom<Highlight[]>(frozenEmptyList<Highlight>());

// ---------------------------------------------------------------------------
// Selection, zoom and highlight state
// ---------------------------------------------------------------------------

export const selectedAnnotationIdsAtom = atom<string[]>(
  frozenEmptyList<string>()
);
export const selectedRelationIdsAtom = atom<string[]>(
  frozenEmptyList<string>()
);
/** Document zoom; 1 is the page at its natural size. */
export const zoomAtom = atom<number>(1);
/** True once the initial zoom (e.g. fit-to-width) has been resolved. */
export const zoomInitialisedAtom = atom<boolean>(false);
export const activeHighlightIdAtom = atom<string | null>(null);
export const hoveredAnnotationIdAtom = atom<string | null>(null);

/**
 * The text selection the user has just completed and nobody has committed or
 * cleared yet. Viewer-level state, so it survives its page leaving the
 * virtual window; `pending.ts` owns every write.
 */
export const pendingSelectionAtom = atom<PendingSelection | null>(null);

// ---------------------------------------------------------------------------
// Display settings
// ---------------------------------------------------------------------------

export type DisplaySettings = {
  showStructural: boolean;
  showStructuralRelationships: boolean;
  showSelectedOnly: boolean;
  showBoundingBoxes: boolean;
  labelDisplay: LabelDisplay;
  /** `null` or `[]` means no filter. */
  visibleLabelIds: string[] | null;
};

export const DEFAULT_DISPLAY_SETTINGS: Readonly<DisplaySettings> =
  Object.freeze({
    showStructural: false,
    showStructuralRelationships: false,
    showSelectedOnly: false,
    showBoundingBoxes: true,
    labelDisplay: "hover",
    visibleLabelIds: null,
  });

export const displaySettingsAtom = atom<DisplaySettings>(
  DEFAULT_DISPLAY_SETTINGS
);

// ---------------------------------------------------------------------------
// Editing, DOM and document status
// ---------------------------------------------------------------------------

export const editingAtom = atom<{
  readOnly: boolean;
  activeLabel: AnnotationLabel | null;
}>(Object.freeze({ readOnly: false, activeLabel: null }));

/** The instance's root element; lookups are scoped to it, never to `document`. */
export const rootElementAtom = atom<HTMLElement | null>(null);

/** Where the format is in loading its document. */
export type DocumentStatus = {
  state: "loading" | "ready" | "error";
  /** Loading progress, 0..100, or null when unknown. */
  progress: number | null;
  /** Set whenever `state` is `"error"`. */
  error: Error | null;
};

export const documentStatusAtom = atom<DocumentStatus>(
  Object.freeze({ state: "loading", progress: null, error: null })
);

/** Unique per mounted instance; prefixes any element id that must not collide. */
export const instanceIdAtom = atom<string>("");
