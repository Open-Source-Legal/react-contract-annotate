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
