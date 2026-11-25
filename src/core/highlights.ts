import { sortedPageIndices } from "./geometry/pageIndices";
import type { Highlight } from "./types";

/** Ascending 0-based page indices a highlight paints on; `[]` for a span. */
export function highlightPages(h: Highlight): number[] {
  const { target } = h;
  if (target.kind === "tokens") return sortedPageIndices(target.tokensByPage);
  if (target.kind === "bounds") return sortedPageIndices(target.boundsByPage);
  return [];
}

/** True for highlights that index into the document text (DOCX). */
export function isSpanHighlight(h: Highlight): boolean {
  return h.target.kind === "span";
}
