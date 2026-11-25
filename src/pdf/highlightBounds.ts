/**
 * Where a highlight is drawn on the PDF's pages: its box on a page (given,
 * or derived from its tokens) and the first page it is drawn on. The overlay
 * paints from these and the driver, the viewport and the pages answer "can it
 * be drawn" and "where do I scroll" from the same ones, so they cannot
 * disagree.
 */
import type { BoundingBox, Highlight, TokenId } from "../core/index";
import { highlightPages } from "../core/index";
import type { PDFPageInfo } from "./PDFPageInfo";

/** The tokens a highlight marks on a page; `[]` unless it has token targets. */
export function highlightTokenIds(
  highlight: Highlight,
  pageIndex: number
): TokenId[] {
  const { target } = highlight;
  if (target.kind !== "tokens") return [];
  const indices = target.tokensByPage[pageIndex];
  return Array.isArray(indices)
    ? indices.map((tokenIndex) => ({ pageIndex, tokenIndex }))
    : [];
}

/**
 * The box of a highlight on a page, in PAWLs units (not scaled): the one it
 * is given for the page, else the box around its tokens there. Null when it
 * has neither: a span highlight, a page it does not mention, or tokens the
 * page does not have.
 */
export function highlightPageBounds(
  highlight: Highlight,
  pageInfo: PDFPageInfo
): BoundingBox | null {
  const { target } = highlight;
  if (target.kind === "span") return null;
  const pageIndex = pageInfo.page.pageNumber - 1;

  const given = target.boundsByPage?.[pageIndex];
  if (given) return given;
  if (target.kind !== "tokens") return null;

  const tokens = highlightTokenIds(highlight, pageIndex);
  if (tokens.length === 0) return null;
  return pageInfo.getBoundsForTokens(tokens) ?? null;
}

/**
 * Index of the first of `pages` (in page order) a highlight is drawn on;
 * null when it is drawn on none.
 */
export function firstDrawnPage(
  highlight: Highlight,
  pages: readonly PDFPageInfo[]
): number | null {
  for (const pageIndex of highlightPages(highlight)) {
    const info = pages[pageIndex];
    if (info && highlightPageBounds(highlight, info) !== null) return pageIndex;
  }
  return null;
}
