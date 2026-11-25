/**
 * Constants of the PDF format: ported value-for-value from OpenContracts
 * (frontend/src/assets/configurations/constants.ts at 98286cabf), then the
 * library's own additions.
 */

// ---------------------------------------------------------------------------
// Ported from OpenContracts
// ---------------------------------------------------------------------------

/**
 * Fraction of page dimensions above which a single token is considered a
 * degenerate page-level element (e.g. a full-page image capture). Such tokens
 * are excluded from annotation overlap detection because they would make
 * every annotation's bounding box span the entire page.
 */
export const PAGE_SPANNING_TOKEN_THRESHOLD = 0.9;

/**
 * Stacking order of the per-page overlay layers. (OpenContracts' full-page
 * `PDF_SELECTION_LAYER: 1` overlay is gone: the selection layer is the
 * page's canvas wrapper, see `SelectionLayer`.)
 */
export const Z_INDEX = {
  /** PDF page NativeLinkLayer: anchors over pdf.js external-link
   *  annotations, above the canvas and the pending selection, so its
   *  `pointer-events: auto` anchors receive clicks first. */
  PDF_NATIVE_LINK_LAYER: 2,
} as const;

/**
 * Colour of a selection being made or pending when no label colours it
 * (OpenContracts' `SelectionLayer` literal `"#0066cc"`).
 */
export const SELECTION_COLOR = "#0066cc";
/** Touch hold (ms) that starts a text selection (`LONG_PRESS_DURATION`). */
export const LONG_PRESS_MS = 500;
/**
 * Touch movement (px) that cancels a pending long press
 * (`TOUCH_MOVE_THRESHOLD`).
 */
export const TOUCH_MOVE_THRESHOLD_PX = 10;
/** Haptic pulse (ms) when a long press starts a selection. */
export const LONG_PRESS_VIBRATION_MS = 50;

// Annotation visual styling
/** RGB tuple for the rejected (maroon) state. */
export const REJECTED_RGB = { r: 128, g: 0, b: 0 } as const;
/** RGB tuple for the approved (green) state. */
export const APPROVED_RGB = { r: 46, g: 204, b: 113 } as const;
/** Border-radius for annotation bounding boxes and label pills. */
export const ANNOTATION_BOUNDARY_RADIUS = "6px";
/** Border-radius for individual annotation tokens. */
export const ANNOTATION_TOKEN_RADIUS = "4px";

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

/**
 * Stacking of an annotation box (OpenContracts' `zIndex: 2`): the fallback
 * of `--rca-z-annotation`.
 */
export const ANNOTATION_Z_INDEX = 2;

/**
 * Stacking of a highlight box: the fallback of `--rca-z-highlight`.
 * OpenContracts' result boundary sets no `z-index`, so highlights paint in
 * document order, below the annotation boxes.
 */
export const HIGHLIGHT_Z_INDEX = "auto";

/**
 * Stacking of the pending selection and of a selection being made: the
 * fallback of `--rca-z-pending`. OpenContracts draws them with the
 * annotation's boundary, `zIndex: 2`.
 */
export const PENDING_Z_INDEX = 2;

/**
 * Text of the bar above an annotation box that holds the label chip
 * (`SelectionInfo`): the fallbacks of `--rca-label-font-weight` and
 * `--rca-label-font-size`.
 */
export const ANNOTATION_LABEL_FONT_WEIGHT = "bold";
export const ANNOTATION_LABEL_FONT_SIZE = "12px";

/**
 * The SOURCE / TARGET relation badge: its stacking inside the label bar and
 * the size of its tooltip text, the fallbacks of `--rca-z-relation-badge`
 * and `--rca-relation-badge-font-size`.
 */
export const RELATION_BADGE_Z_INDEX = 1;
export const RELATION_BADGE_FONT_SIZE = "0.75rem";

// ---------------------------------------------------------------------------
// Library additions
// ---------------------------------------------------------------------------

/** Vertical gap (px) the PDF viewport adds below each page. */
export const PAGE_GAP_PX = 32;
/** Pages rendered beyond the visible range on each side. */
export const PAGE_OVERSCAN = 2;
/**
 * How long the PDF viewport waits after the last zoom-driven render request
 * before re-rendering the mounted pages together (OpenContracts' shared
 * render debounce, `PDF.tsx`).
 */
export const PAGE_RENDER_DEBOUNCE_MS = 100;
/**
 * Farthest (px) the pointer may move between pressing and releasing on an
 * annotation for the press to count as a click rather than a drag.
 */
export const CLICK_DRAG_TOLERANCE_PX = 3;
/** `KeyboardEvent.key` of the key that cancels a selection being made. */
export const ESCAPE_KEY = "Escape";
