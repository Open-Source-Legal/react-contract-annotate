import { TEXT_BLOCK_HIGHLIGHT_COLOR } from "./constants";
import { safeCssColor } from "./geometry/colorUtils";
import { sortedPageIndices } from "./geometry/pageIndices";
import type { Highlight } from "./types";

/**
 * The colour a highlight is drawn in: its own when it is a safe CSS colour,
 * else the default highlight colour (OpenContracts' text-block deep-link
 * blue). Like `labelColor`, for formats to share.
 */
export function highlightColor(h: Highlight): string {
  return safeCssColor(h.color, TEXT_BLOCK_HIGHLIGHT_COLOR);
}

/**
 * Ascending 0-based page indices a highlight paints on; `[]` for a span. A
 * token highlight paints on the pages of its tokens and of its given bounds.
 */
export function highlightPages(h: Highlight): number[] {
  const { target } = h;
  if (target.kind === "tokens") {
    return sortedPageIndices({ ...target.tokensByPage, ...target.boundsByPage });
  }
  if (target.kind === "bounds") return sortedPageIndices(target.boundsByPage);
  return [];
}

/** True for highlights that index into the document text (DOCX). */
export function isSpanHighlight(h: Highlight): boolean {
  return h.target.kind === "span";
}
