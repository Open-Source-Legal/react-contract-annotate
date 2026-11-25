import { SELECTION_MENU } from "../constants";

/**
 * Clamp a context-menu position so the menu stays fully inside the viewport.
 *
 * The menu is initially placed `offset` pixels to the right/below the cursor.
 * If it would overflow the viewport edge, the menu flips to the opposite side
 * of the cursor.  A minimum margin of `minEdgeGap` pixels is enforced on all
 * sides so the menu never hugs the viewport border.
 *
 * @param clientX   - Cursor X in viewport coordinates (e.g. event.clientX)
 * @param clientY   - Cursor Y in viewport coordinates (e.g. event.clientY)
 * @param menuWidth - Approximate menu width (defaults to SELECTION_MENU.APPROX_WIDTH)
 * @param menuHeight - Approximate menu height (defaults to SELECTION_MENU.APPROX_HEIGHT)
 * @param offset    - Distance from cursor to near edge of the menu (default 10)
 * @param minEdgeGap - Minimum gap between menu edge and viewport edge (default 10)
 */
export function clampMenuPosition(
  clientX: number,
  clientY: number,
  menuWidth: number = SELECTION_MENU.APPROX_WIDTH,
  menuHeight: number = SELECTION_MENU.APPROX_HEIGHT,
  offset: number = 10,
  minEdgeGap: number = 10
): { x: number; y: number } {
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;

  // Start to the right/below the cursor
  let x = clientX + offset;
  let y = clientY + offset;

  // Flip to the left of cursor if overflowing right edge
  if (x + menuWidth > viewportWidth - minEdgeGap) {
    x = Math.max(minEdgeGap, clientX - menuWidth - offset);
  }

  // Flip above cursor if overflowing bottom edge
  if (y + menuHeight > viewportHeight - minEdgeGap) {
    y = Math.max(minEdgeGap, clientY - menuHeight - offset);
  }

  // Final clamp to keep within the viewport
  x = Math.max(minEdgeGap, x);
  y = Math.max(minEdgeGap, y);

  return { x, y };
}
