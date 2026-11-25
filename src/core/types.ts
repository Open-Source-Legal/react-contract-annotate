/**
 * Public types of the library: the data model, the props shared by every
 * format, the imperative handle and the per-format inputs. Plain JSON goes in;
 * no class instances cross the public boundary.
 */
import type {
  CSSProperties,
  MouseEvent as ReactMouseEvent,
  ReactNode,
} from "react";

// ---------------------------------------------------------------------------
// Geometry and annotation JSON
// ---------------------------------------------------------------------------

/** Rectangle in PDF page coordinates (CSS pixels at scale 1). */
export type BoundingBox = {
  top: number;
  bottom: number;
  left: number;
  right: number;
};

/** Reference to one token of one PAWLs page. */
export type TokenId = {
  pageIndex: number;
  tokenIndex: number;
};

/** DOCX / text annotation JSON: character offsets into the document text. */
export type SpanAnnotationJson = {
  start: number;
  end: number;
};

/** v1 annotation JSON of one page. */
export type SinglePageAnnotationJson = {
  bounds: BoundingBox;
  tokensJsons: TokenId[];
  rawText: string;
};

/** v1 token annotation JSON, keyed by 0-based page index. */
export type MultipageAnnotationJson = Record<number, SinglePageAnnotationJson>;

/** Per-page data of compact annotation JSON v2. */
export interface CompactPageData {
  /** Bounds as array: [top, left, right, bottom] */
  b: [number, number, number, number];
  /** Token indices as range-encoded string, e.g. "35-37,40" */
  t: string;
}

/**
 * Compact v2 token annotation JSON: `{ v: 2, p: { "0": { b, t } } }`. A type
 * alias rather than an interface so it stays assignable to
 * `Record<string, unknown>`, which the format guards take.
 */
export type CompactAnnotationJson = {
  /** Version marker, always 2. */
  v: 2;
  /** Pages keyed by page index string. */
  p: Record<string, CompactPageData>;
};

// ---------------------------------------------------------------------------
// PAWLs (parser output: tokens with bounding boxes)
// ---------------------------------------------------------------------------

/** One PAWLs token. The image fields are present on image tokens only. */
export interface PawlsToken {
  x: number;
  y: number;
  height: number;
  width: number;
  text: string;
  is_image?: boolean;
  image_path?: string;
  base64_data?: string;
  format?: string;
  content_hash?: string;
  original_width?: number;
  original_height?: number;
  image_type?: string;
  token_index?: number;
}

/** v1 PAWLs page: the page box and its tokens. */
export type PawlsPage = {
  page: { width: number; height: number; index: number };
  tokens: PawlsToken[];
};

/** Image metadata of a compact PAWLs token (short keys). */
export interface CompactPawlsImageMeta {
  /** image_path */
  p?: string;
  /** base64_data */
  b64?: string;
  /** format */
  f?: string;
  /** content_hash */
  ch?: string;
  /** original_width */
  ow?: number;
  /** original_height */
  oh?: number;
  /** image_type */
  it?: string;
}

/** One compact PAWLs page: `t` holds `[x, y, width, height, text, imageMeta?]`. */
export interface CompactPawlsPage {
  w: number;
  h: number;
  t: (number | string | CompactPawlsImageMeta)[][];
}

/** Compact PAWLs v2: `{ v: 2, p: [{ w, h, t }] }`. */
export interface CompactPawls {
  v: number;
  p: CompactPawlsPage[];
}

/** Anything the PDF annotator accepts as PAWLs data. */
export type PawlsInput = PawlsPage[] | CompactPawls;

// ---------------------------------------------------------------------------
// Data model
// ---------------------------------------------------------------------------

export interface AnnotationLabel {
  id: string;
  text: string;
  /** Default grey, as in OpenContracts. */
  color?: string;
  description?: string;
  icon?: string;
}

/**
 * An annotation as the host passes it in. Annotation objects are treated as
 * immutable: normalisation is memoised by object identity, so change an
 * annotation by passing a new object, never by mutating one in place.
 */
export interface Annotation<TMeta = unknown> {
  id: string;
  annotationLabel: AnnotationLabel;
  rawText?: string;
  /** 0-based first page (token annotations). */
  page?: number;
  json:
    | MultipageAnnotationJson // v1  { "0": { bounds, tokensJsons, rawText } }
    | CompactAnnotationJson // v2  { v: 2, p: { "0": { b, t } } }
    | SpanAnnotationJson; // { start, end }
  structural?: boolean;
  /** Visual state only. */
  approved?: boolean;
  /** Visual state only. */
  rejected?: boolean;
  /** OC_URL link annotations. */
  linkUrl?: string | null;
  /** Host passthrough, returned in callbacks. */
  meta?: TMeta;
}

export interface Relation {
  id: string;
  label: AnnotationLabel;
  sourceIds: string[];
  targetIds: string[];
  structural?: boolean;
}

/**
 * Any non-annotation thing to paint and jump to: search hit, chat source,
 * deep-linked block, diff region. Replaces OpenContracts' separate search
 * result / chat source / text block overlays.
 */
export interface Highlight {
  id: string;
  color?: string;
  label?: string;
  target:
    | {
        kind: "tokens";
        tokensByPage: Record<number, number[]>;
        /** Derived from the tokens when absent. */
        boundsByPage?: Record<number, BoundingBox>;
      }
    | { kind: "bounds"; boundsByPage: Record<number, BoundingBox> }
    | { kind: "span"; start: number; end: number };
}

// ---------------------------------------------------------------------------
// Creating annotations
// ---------------------------------------------------------------------------

/**
 * A not-yet-persisted annotation. `json` is v1 multipage token JSON for PDF
 * and `{ start, end }` for DOCX.
 */
export interface AnnotationDraft {
  json: MultipageAnnotationJson | SpanAnnotationJson;
  rawText: string;
  page: number;
  annotationLabel: AnnotationLabel | null;
}

/** The draft plus an `anchor` point in viewport coordinates. */
export type PendingSelection = AnnotationDraft & {
  anchor: { x: number; y: number };
};

export type PendingActions = {
  pending: PendingSelection;
  anchor: { x: number; y: number };
  commit(label?: AnnotationLabel): void;
  clear(): void;
  copyText(): Promise<boolean>;
};

export type SelectionMenuContext = PendingActions;

// ---------------------------------------------------------------------------
// Common props
// ---------------------------------------------------------------------------

export type LabelDisplay = "always" | "hover" | "hide";

export type ChangeInfo = { source: "user" | "api" };

export interface AnnotatorCommonProps<TMeta = unknown> {
  // data
  annotations: Annotation<TMeta>[];
  relations?: Relation[];
  highlights?: Highlight[];

  // state: each is controlled when the value prop is defined, else internal
  selectedAnnotationIds?: string[];
  defaultSelectedAnnotationIds?: string[];
  onSelectionChange?(ids: string[], info: ChangeInfo): void;

  zoom?: number;
  /** Default `"fit-width"`. */
  defaultZoom?: number | "fit-width";
  onZoomChange?(zoom: number): void;

  activeHighlightId?: string | null;
  defaultActiveHighlightId?: string | null;
  onActiveHighlightChange?(id: string | null): void;

  /** Display only, props only. */
  selectedRelationIds?: string[];

  // display filters (plain props; the host owns these toggles)
  /** Default false. */
  showStructural?: boolean;
  /** Default false. */
  showStructuralRelationships?: boolean;
  /** Default false. */
  showSelectedOnly?: boolean;
  /** Default true. */
  showBoundingBoxes?: boolean;
  /** Default `"hover"`. */
  labelDisplay?: LabelDisplay;
  /** `null`, `undefined` or `[]` means no filter (as in OpenContracts). */
  visibleLabelIds?: string[] | null;
  /** Default true. */
  scrollOnSelect?: boolean;

  // creating annotations
  /** Default false. */
  readOnly?: boolean;
  activeLabel?: AnnotationLabel | null;
  onCreateAnnotation?(draft: AnnotationDraft): void | Promise<void>;
  onTextSelect?(pending: PendingSelection, actions: PendingActions): void;

  // interaction callbacks
  onAnnotationClick?(a: Annotation<TMeta>, e: ReactMouseEvent): void;
  onAnnotationHover?(a: Annotation<TMeta> | null): void;
  onOpenLink?(url: string, source: Annotation<TMeta> | "native"): void;

  // render slots: nothing is rendered when a slot is absent
  renderSelectionMenu?(ctx: SelectionMenuContext): ReactNode;
  renderAnnotationActions?(
    a: Annotation<TMeta>,
    ctx: { selected: boolean; hovered: boolean }
  ): ReactNode;
  renderLoading?(progress: number | null): ReactNode;
  renderError?(error: Error): ReactNode;

  // lifecycle
  onDocumentLoad?(info: { pageCount: number | null; text: string }): void;
  onError?(error: Error): void;
  onVisiblePagesChange?(range: [number, number]): void;

  className?: string;
  style?: CSSProperties;
}

// ---------------------------------------------------------------------------
// The handle
// ---------------------------------------------------------------------------

/** One interface for every format, via `ref`. */
export interface AnnotatorHandle {
  /** Resolves false if the id is unknown / not drawable. */
  scrollToAnnotation(
    id: string,
    opts?: { select?: boolean; behavior?: ScrollBehavior }
  ): Promise<boolean>;
  scrollToHighlight(
    id: string,
    opts?: { activate?: boolean; behavior?: ScrollBehavior }
  ): Promise<boolean>;
  scrollToPage(
    pageIndex: number,
    opts?: { behavior?: ScrollBehavior }
  ): boolean;

  getZoom(): number;
  setZoom(zoom: number | "fit-width"): void;
  zoomIn(): void;
  zoomOut(): void;

  getSelectedAnnotationIds(): string[];
  selectAnnotations(ids: string[], opts?: { scroll?: boolean }): void;
  clearSelection(): void;

  getPendingSelection(): PendingSelection | null;
  commitPendingSelection(label?: AnnotationLabel): void;
  clearPendingSelection(): void;

  /** Null for unpaginated formats. */
  getPageCount(): number | null;
  getVisiblePageRange(): [number, number] | null;
  getText(): string;
  findText(query: string, opts?: { caseSensitive?: boolean }): Highlight[];
  getScrollContainer(): HTMLElement | null;
}

// ---------------------------------------------------------------------------
// Format-specific inputs
// ---------------------------------------------------------------------------

/**
 * The part of pdf.js' `PDFDocumentProxy` the library relies on. `src/core`
 * must not import `pdfjs-dist`, so the public prop is typed structurally: a
 * real `PDFDocumentProxy` is assignable to it, and the PDF renderer narrows it
 * back.
 */
export interface PdfDocumentProxyLike {
  readonly numPages: number;
  getPage(pageNumber: number): Promise<unknown>;
}

export interface PdfAnnotatorProps<M = unknown>
  extends AnnotatorCommonProps<M> {
  source:
    | {
        url: string;
        httpHeaders?: Record<string, string>;
        withCredentials?: boolean;
      }
    | { data: Uint8Array | ArrayBuffer }
    | { document: PdfDocumentProxyLike };
  /** v1 pages or compact v2 (`{ v: 2, p: [...] }`). */
  pawls?: PawlsInput | null;
  /** Default true. */
  enableNativeLinks?: boolean;
}

export interface DocxAnnotatorProps<M = unknown>
  extends AnnotatorCommonProps<M> {
  source: { url: string } | { data: Uint8Array };
  /** The parser's plain text the offsets index into. */
  text: string;
  /** Where the host serves docxodus' wasm assets. */
  wasmBaseUrl: string;
}

/** Input of the root `<DocumentAnnotator document={...} />` dispatcher. */
export type DocumentInput =
  | ({ format: "pdf" } & Pick<
      PdfAnnotatorProps<never>,
      "source" | "pawls" | "enableNativeLinks"
    >)
  | ({ format: "docx" } & Pick<
      DocxAnnotatorProps<never>,
      "source" | "text" | "wasmBaseUrl"
    >);
