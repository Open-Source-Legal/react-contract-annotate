/**
 * Token text search: the document's text as its PAWLs tokens spell it, and
 * the highlights for the matches of a query. Ported from OpenContracts'
 * `createTokenStringSearch` (`annotator/utils.ts`) and the PDF branch of
 * `useTextSearch` (`annotator/hooks/useTextSearch.tsx`, 98286cabf).
 *
 * Changed from OpenContracts: pages are joined by a space like tokens are, so
 * the last word of a page does not run into the first of the next (and the
 * text equals what `getText()` has always returned); the query is matched
 * literally (OpenContracts built a `RegExp` from it, so `(` threw and `.`
 * matched anything) with a case-insensitive comparison that keeps indices
 * aligned with the text; a match lists each token it touches once, in
 * ascending order, instead of once per character; and the lead-in / lead-out
 * context and the React nodes that carried it are gone (the result is a
 * plain `Highlight`).
 */
import type { Highlight, TokenId } from "../core/index";
import type { PDFPageInfo } from "./PDFPageInfo";

export interface SearchIndex {
  /** Every page's token texts, joined by single spaces. */
  text: string;
  /** The token each character of `text` belongs to; none for a separator. */
  charToToken: Record<number, TokenId>;
}

/**
 * Indexes the tokens of `pages` (in page order). Tokens without text (image
 * tokens, missing text) are not part of the text, and neither is a page
 * without any.
 */
export function buildSearchIndex(pages: readonly PDFPageInfo[]): SearchIndex {
  const parts: string[] = [];
  const charToToken: Record<number, TokenId> = {};
  let length = 0;

  pages.forEach((info, pageIndex) => {
    info.tokens.forEach((token, tokenIndex) => {
      const text = token?.text ?? "";
      if (text === "") return;
      if (length > 0) {
        parts.push(" ");
        length += 1;
      }
      // One object for all the characters of the token.
      const id: TokenId = { pageIndex, tokenIndex };
      for (let i = 0; i < text.length; i++) charToToken[length + i] = id;
      parts.push(text);
      length += text.length;
    });
  });

  return { text: parts.join(""), charToToken };
}

/** The query as the index spells whitespace: runs collapsed, ends trimmed. */
function normaliseQuery(query: string): string {
  return query.replace(/\s+/g, " ").trim();
}

function escapeRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The tokens of `text[start, end)`, grouped by page, each listed once. */
function tokensOfRange(
  index: SearchIndex,
  start: number,
  end: number
): Record<number, number[]> {
  const tokensByPage: Record<number, number[]> = {};
  let previous: TokenId | undefined;
  for (let at = start; at < end; at++) {
    const id = index.charToToken[at];
    if (id === undefined || id === previous) continue;
    previous = id;
    (tokensByPage[id.pageIndex] ??= []).push(id.tokenIndex);
  }
  return tokensByPage;
}

/**
 * Every non-overlapping match of `query` in the index, in document order, as
 * token highlights `find-0`, `find-1`, …. The query is a literal string
 * (whitespace runs count as one space); case-insensitive unless
 * `caseSensitive`. An empty or whitespace-only query matches nothing.
 */
export function findTokenMatches(
  index: SearchIndex,
  query: string,
  { caseSensitive = false }: { caseSensitive?: boolean } = {}
): Highlight[] {
  const needle = normaliseQuery(query);
  if (needle === "") return [];

  // Without the `u` flag a case-insensitive comparison works per UTF-16 unit
  // and never changes a match's length, so offsets stay aligned (lowercasing
  // the text can change its length, e.g. "İ").
  const pattern = new RegExp(escapeRegExp(needle), caseSensitive ? "g" : "gi");
  const highlights: Highlight[] = [];
  for (const match of index.text.matchAll(pattern)) {
    const start = match.index ?? 0;
    const tokensByPage = tokensOfRange(index, start, start + match[0].length);
    highlights.push({
      id: `find-${highlights.length}`,
      target: { kind: "tokens", tokensByPage },
    });
  }
  return highlights;
}
