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
