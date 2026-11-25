// The public surface of `…/core`: the data model, the shell and the format
// contract a renderer is built on, and the geometry helpers a format needs.
// Atoms stay private, and so do the constants but the key formats share.

export * from "./types";

export { fromOpenContractsExport } from "./fromOpenContractsExport";
export type {
  OpenContractAnnotationExport,
  OpenContractAnnotationJsonExport,
  OpenContractDocExport,
  OpenContractLabelLookup,
  OpenContractRelationshipExport,
  OpenContractsExportInputs,
} from "./fromOpenContractsExport";

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
  useAnnotationActions,
  useDevWarnOnce,
  useDisplaySettings,
  useDocumentStatus,
  useEditing,
  useHighlights,
  useOnAnnotationClick,
  useOnAnnotationHover,
  useReadDocumentData,
  useRenderAnnotationActions,
  useRootElement,
  useSelectedAnnotationIds,
  useSelectedRelations,
  useSetDocumentStatus,
  useZoom,
} from "./formatHooks";
export type { DocumentStatusUpdate } from "./formatHooks";
export type { DisplaySettings, DocumentStatus } from "./state/atoms";

export { ESCAPE_KEY } from "./constants";
export { isUrlAnnotation, useOpenLink } from "./links";
export { useAnnotationActionButtons } from "./AnnotationActionButtons";
export { LabelChip, labelColor } from "./LabelChip";
export { styled } from "./styled";
export type { LabelChipProps } from "./LabelChip";

export {
  useCompleteSelection,
  usePendingActions,
  usePendingSelection,
} from "./pending";

export { useRequestScroll, useScrollRequest } from "./scroll";
export { centreBox } from "./centreBox";
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
