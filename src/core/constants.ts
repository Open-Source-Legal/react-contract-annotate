/**
 * Constants ported value-for-value from OpenContracts
 * (frontend/src/assets/configurations/constants.ts at 98286cabf), followed by
 * the library's own additions.
 */

// ---------------------------------------------------------------------------
// Ported from OpenContracts
// ---------------------------------------------------------------------------

// Document zoom bounds
/** Minimum document zoom level (50%). */
export const ZOOM_MIN = 0.5;
/** Maximum document zoom level (400%). */
export const ZOOM_MAX = 4;
/**
 * Total horizontal breathing room (px) the fit-to-width helper reserves off
 * the container width so the fitted page does not butt up against the
 * container edges.
 */
export const FIT_WIDTH_MARGIN = 16;

/** Colour of the text-block deep-link highlight. */
export const TEXT_BLOCK_HIGHLIGHT_COLOR = "#0EA5E9";

/** Name of the label that marks an annotation as a hyperlink. */
export const OC_URL_LABEL = "OC_URL";
/** Default presentation colour of the `OC_URL` label. */
export const OC_URL_LABEL_COLOR = "#2563EB";

// Reference-mention label codes the enrichment pipeline emits.
export const OC_REF_LAW_LABEL = "OC_REF_LAW";
export const OC_REF_DOC_LABEL = "OC_REF_DOC";
export const OC_REF_SECTION_LABEL = "OC_REF_SECTION";
export const OC_REF_TERM_LABEL = "OC_REF_TERM";

/**
 * Human-facing chip labels for reference mentions: the chip names the kind
 * of reference in plain language rather than the internal label code.
 */
export const REFERENCE_MENTION_DISPLAY_NAMES: Readonly<Record<string, string>> =
  Object.freeze({
    [OC_REF_LAW_LABEL]: "Law",
    [OC_REF_DOC_LABEL]: "Exhibit",
    [OC_REF_SECTION_LABEL]: "Section",
    [OC_REF_TERM_LABEL]: "Defined term",
  });

/** Colour of a label without one (`Selection.tsx`: "grey as the default"). */
export const DEFAULT_LABEL_COLOR = "#616a6b";

// Annotation boundary box-shadow layers (selected state)
export const BOUNDARY_SHADOW_SELECTED = {
  outerBlur: 14,
  outerSpread: 4,
  outerOpacity: 0.13,
  midBlur: 5,
  midSpread: 1,
  midOpacity: 0.1,
  insetBlur: 8,
  insetSpread: 2,
  insetOpacity: 0.07,
} as const;

// Annotation boundary box-shadow layers (unselected state)
export const BOUNDARY_SHADOW_UNSELECTED = {
  outerBlur: 10,
  outerSpread: 2,
  outerOpacity: 0.07,
  midBlur: 3,
  midSpread: 0,
  midOpacity: 0.05,
  insetBlur: 6,
  insetSpread: 1,
  insetOpacity: 0.04,
} as const;

/** Half a PDF point: tolerance when comparing PAWLs and pdf.js page sizes. */
export const PAWLS_COORDINATE_EPSILON = 0.5;

/**
 * Approximate dimensions (px) of the host's selection menu, used to keep it
 * inside the viewport when its real size is not known.
 */
export const SELECTION_MENU = {
  APPROX_WIDTH: 200,
  APPROX_HEIGHT: 200,
} as const;

// Compact annotation JSON v2 safety limits
/** Maximum span for a single range segment. */
export const COMPACT_JSON_MAX_RANGE_SPAN = 10_000;
/** Maximum total tokens across all pages. */
export const COMPACT_JSON_MAX_TOTAL_TOKENS = 50_000;

// ---------------------------------------------------------------------------
// Library additions
// ---------------------------------------------------------------------------

/** Zoom change per step of the zoom handle methods. */
export const ZOOM_STEP = 0.1;
/**
 * Decimal places a stepped zoom is rounded to, so repeated steps do not
 * accumulate floating-point noise (1.1 + 0.1 is 1.2000000000000002).
 */
export const ZOOM_DECIMALS = 6;
/** Scroll behaviour of a scroll request that does not name one. */
export const DEFAULT_SCROLL_BEHAVIOR: ScrollBehavior = "smooth";
/** Message of the error recorded when a format reports failure without one. */
export const DOCUMENT_ERROR_MESSAGE = "The document could not be loaded.";
/** How long a bounded scroll request waits before settling `false`. */
export const SCROLL_SETTLE_TIMEOUT_MS = 5000;
/**
 * Distance (px) from its target at which a scroll to an annotation counts as
 * landed (browsers round scroll offsets).
 */
export const SCROLL_LANDED_TOLERANCE_PX = 1;
/**
 * Animation frames the scroll position must hold still for a scroll to count
 * as landed when no `scrollend` arrives (browsers without it).
 */
export const SCROLL_SETTLE_FRAMES = 10;
/** `KeyboardEvent.key` of the key that cancels a pending selection. */
export const ESCAPE_KEY = "Escape";

/**
 * Defaults of the theming custom properties the shell defines on its root.
 * Renderers read them as `var(--rca-…, <same default>)`.
 */
export const THEME_DEFAULTS = {
  /** `--rca-font-family`: OpenContracts' body font stack (index.css). */
  fontFamily:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", "Roboto", "Oxygen", ' +
    '"Ubuntu", "Cantarell", "Fira Sans", "Droid Sans", "Helvetica Neue", ' +
    "sans-serif",
  /** `--rca-z-annotation`: OpenContracts' annotation box has `zIndex: 2`. */
  zAnnotation: "2",
  /**
   * `--rca-z-highlight`: OpenContracts' result boundary sets no z-index, so
   * highlights paint in document order (`auto`).
   */
  zHighlight: "auto",
  /**
   * `--rca-z-pending`: the pending selection is drawn by the same boundary
   * component as an annotation, with the same `zIndex: 2`.
   */
  zPending: "2",
  /**
   * `--rca-z-menu`: stacking of the selection-menu host, which is portalled
   * to `document.body`. OpenContracts' `Z_INDEX.CONTEXT_MENU` (9999), which
   * its selection menu uses.
   */
  zMenu: "9999",
  /**
   * `--rca-structural-color`: OpenContracts has no colour of its own for
   * structural annotations; this is its default label grey.
   */
  structuralColor: DEFAULT_LABEL_COLOR,
} as const;
