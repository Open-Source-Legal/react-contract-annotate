// The public surface of `…/core`: the data model, the shell and the format
// contract a renderer is built on, and the geometry helpers a format needs.
// Atoms and internal constants stay private.

export * from "./types";

export { AnnotatorShell } from "./AnnotatorShell";
export type { AnnotatorShellProps } from "./AnnotatorShell";

export {
  useNotifyDrawabilityChanged,
  useNotifyFitWidthChanged,
  useRegisterFormatDriver,
} from "./format";
export type { FormatDriver } from "./format";

export {
  useActiveHighlightId,
  useDisplaySettings,
  useDocumentStatus,
  useEditing,
  useHighlights,
  useRootElement,
  useSelectedAnnotationIds,
  useSetDocumentStatus,
  useZoom,
} from "./formatHooks";
export type { DocumentStatusUpdate } from "./formatHooks";
export type { DisplaySettings, DocumentStatus } from "./state/atoms";

export {
  useCompleteSelection,
  usePendingActions,
  usePendingSelection,
} from "./pending";

export { useRequestScroll, useScrollRequest } from "./scroll";
export type {
  ScrollRequest,
  ScrollRequestOptions,
  ScrollTarget,
} from "./scroll";

export { useSetControllable } from "./state/controllable";
export type { ControllableKey } from "./state/controllable";
export { useVisibleAnnotations } from "./state/visibility";
export { annotationPages, draftPages } from "./normalize";
export type {
  InternalAnnotation,
  SpanAnnotation,
  TokenAnnotation,
} from "./normalize";
export { highlightPages } from "./highlights";

/**
 * The instance store, for a format that keeps per-instance atoms of its own
 * (read and write them with `{ store }`). The library's own atoms stay
 * private; reach its state through the hooks above.
 */
export { useAnnotatorStore } from "./state/AnnotatorProvider";
export type { AnnotatorStore } from "./state/AnnotatorProvider";

export {
  doOverlap,
  normalizeBounds,
  resolvePageTokens,
  scaled,
  spanningBound,
} from "./geometry/transform";
export { computeFitToWidthZoom } from "./geometry/pdfZoom";
export { expandAnnotationJson } from "./geometry/compactAnnotationJson";
export { expandPawlsPages } from "./geometry/compactPawls";

// Layout constants of the paginated (PDF) format.
export {
  PAGE_GAP_PX,
  PAGE_OVERSCAN,
  PAGE_RENDER_DEBOUNCE_MS,
  PAGE_SPANNING_TOKEN_THRESHOLD,
} from "./constants";
