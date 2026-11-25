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

/** Stacking order of the per-page overlay layers. */
export const Z_INDEX = {
  /** PDF page SelectionLayer: full-page overlay capturing the mouse for
   *  drag-to-select. Sits above the rendered canvas. */
  PDF_SELECTION_LAYER: 1,
  /** PDF page NativeLinkLayer: anchors over pdf.js external-link
   *  annotations. Must sit above `PDF_SELECTION_LAYER` so its
   *  `pointer-events: auto` anchors receive clicks first. */
  PDF_NATIVE_LINK_LAYER: 2,
} as const;

// Annotation visual styling
/** RGB tuple for the rejected (maroon) state. */
export const REJECTED_RGB = { r: 128, g: 0, b: 0 } as const;
/** RGB tuple for the approved (green) state. */
export const APPROVED_RGB = { r: 46, g: 204, b: 113 } as const;
/** Border-radius for annotation bounding boxes and label pills. */
export const ANNOTATION_BOUNDARY_RADIUS = "6px";
/** Border-radius for individual annotation tokens. */
export const ANNOTATION_TOKEN_RADIUS = "4px";

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

// Annotation boundary background opacity
export const BOUNDARY_OPACITY_SELECTED = 0.18;
export const BOUNDARY_OPACITY_UNSELECTED = 0.06;

// Token highlight opacity
export const TOKEN_OPACITY_HIGH = 0.38;
export const TOKEN_OPACITY_LOW = 0.22;

// Token shadow
export const TOKEN_SHADOW_BLUR = 4;
export const TOKEN_SHADOW_SPREAD = 1;

/** Pixels added around each token to close inter-token gaps. */
export const TOKEN_EXPANSION_PX = 1;

/** Half a PDF point: tolerance when comparing PAWLs and pdf.js page sizes. */
export const PAWLS_COORDINATE_EPSILON = 0.5;

/**
 * Fraction of page dimensions above which a single token is considered a
 * degenerate page-level element (e.g. a full-page image capture). Such tokens
 * are excluded from annotation overlap detection because they would make
 * every annotation's bounding box span the entire page.
 */
export const PAGE_SPANNING_TOKEN_THRESHOLD = 0.9;

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
/** How long a bounded scroll request waits before settling `false`. */
export const SCROLL_SETTLE_TIMEOUT_MS = 5000;
/** Vertical gap (px) the PDF viewport adds below each page. */
export const PAGE_GAP_PX = 32;
/** Pages rendered beyond the visible range on each side. */
export const PAGE_OVERSCAN = 2;
/** Touch hold (ms) that starts a text selection. */
export const LONG_PRESS_MS = 500;
/** Touch movement (px) that cancels a pending long press. */
export const TOUCH_MOVE_THRESHOLD_PX = 10;
