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
  useAllAnnotations,
  useDevWarnOnce,
  useDisplaySettings,
  useDocumentStatus,
  useEditing,
  useHighlights,
  useOnAnnotationClick,
  useOnAnnotationHover,
  useRenderAnnotationActions,
  useRootElement,
  useSelectedAnnotationIds,
  useSelectedRelations,
  useSetDocumentStatus,
  useZoom,
} from "./formatHooks";
export type { DocumentStatusUpdate } from "./formatHooks";
export type { DisplaySettings, DocumentStatus } from "./state/atoms";

export { isUrlAnnotation, useOpenLink } from "./links";
export { LabelChip, labelColor } from "./LabelChip";
export type { LabelChipProps } from "./LabelChip";

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
export { highlightColor, highlightPages, isSpanHighlight } from "./highlights";

export {
  doOverlap,
  hexToRgb,
  normalizeBounds,
  resolvePageTokens,
  scaled,
  spanningBound,
} from "./geometry/transform";
export { computeAnnotationBoxShadow } from "./geometry/colorUtils";
export { computeFitToWidthZoom } from "./geometry/pdfZoom";
export { expandAnnotationJson } from "./geometry/compactAnnotationJson";
export { expandPawlsPages } from "./geometry/compactPawls";
