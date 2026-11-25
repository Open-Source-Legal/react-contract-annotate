// The public surface of `…/core`: the data model, the shell and the format
// contract a renderer is built on, and the geometry helpers a format needs.
// Atoms and internal constants stay private.

export * from "./types";

export { AnnotatorShell } from "./AnnotatorShell";
export type { AnnotatorShellProps } from "./AnnotatorShell";

export { useNotifyFitWidthChanged, useRegisterFormatDriver } from "./format";
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

export { useRequestScroll, useScrollRequest } from "./scroll";
export type {
  ScrollRequest,
  ScrollRequestOptions,
  ScrollTarget,
} from "./scroll";

export { useSetControllable } from "./state/controllable";
export type { ControllableKey } from "./state/controllable";
export { useVisibleAnnotations } from "./state/visibility";
export type {
  InternalAnnotation,
  SpanAnnotation,
  TokenAnnotation,
} from "./normalize";

export { scaled, spanningBound } from "./geometry/transform";
export { expandAnnotationJson } from "./geometry/compactAnnotationJson";
export { expandPawlsPages } from "./geometry/compactPawls";
