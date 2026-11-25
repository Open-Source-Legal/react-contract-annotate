/**
 * One PDF page with its PAWLs tokens at a given scale: the token geometry the
 * PDF layers draw with. Ported from OpenContracts (98286cabf)
 * `components/annotator/types/pdf.ts`, without `getAnnotationForBounds` /
 * `getFreeFormAnnotationForBounds` (the library builds drafts from
 * `getPageAnnotationJson`). `convertAnnotationTokensToText` moved here from
 * `components/annotator/utils.ts`. The page's `bounds` and
 * `getScreenSpaceBounds` are gone (OpenContracts guarded on the bounds but
 * never read them, and nothing here needs screen-space bounds), and
 * `getBoundsForTokens` returns undefined when no token qualifies.
 */
import type { PDFPageProxy } from "pdfjs-dist/types/src/display/api";

import {
  doOverlap,
  normalizeBounds,
  scaled,
  spanningBound,
} from "../core/index";
import type {
  BoundingBox,
  PawlsToken,
  SinglePageAnnotationJson,
  TokenId,
} from "../core/index";
import { PAGE_SPANNING_TOKEN_THRESHOLD } from "./constants";

export type Optional<T> = T | undefined;

// Somehow (still trying to figure this one out), undefined tokens are getting
// passed to getScaledTokenBounds and this is blowing up the entire app. For now,
// test for undefined token and just return this dummy token json.
export const undefined_bounding_box: BoundingBox = Object.freeze({
  top: 0,
  bottom: 0,
  left: 0,
  right: 0,
});

export class PDFPageInfo {
  private readonly viewport: ReturnType<PDFPageProxy["getViewport"]>;

  constructor(
    public readonly page: PDFPageProxy,
    public readonly tokens: PawlsToken[] = [],
    public scale: number
  ) {
    this.viewport = page.getViewport({ scale: 1 });
  }

  /**
   * Returns true if a token should participate in annotation selection.
   * Filters out degenerate tokens such as page-level bounding boxes emitted
   * by some parsers (e.g. Docling) which have empty text and cover the
   * entire page.  Including them would cause every annotation's spanning
   * bound to expand to the full page dimensions.
   */
  private isSelectableToken(
    t: PawlsToken,
    pageWidth: number,
    pageHeight: number
  ): boolean {
    // Exclude all non-image tokens with empty text. While the page-spanning
    // Docling tokens are the most problematic case, any empty-text token
    // contributes no selectable content and would only inflate annotation
    // bounding boxes without adding meaningful text to the selection.
    if (!t.text?.trim() && !t.is_image) return false;

    // Skip tokens that span the entire page (degenerate page captures)
    if (
      t.width >= pageWidth * PAGE_SPANNING_TOKEN_THRESHOLD &&
      t.height >= pageHeight * PAGE_SPANNING_TOKEN_THRESHOLD
    ) {
      return false;
    }

    return true;
  }

  /**
   * The tokens of this page that overlap any of `selections` (rectangles in
   * the page's coordinates at this page's `scale`), with their unscaled
   * spanning box and text; no tokens, an empty box and text, when none does.
   */
  getPageAnnotationJson(selections: BoundingBox[]): SinglePageAnnotationJson {
    const viewport = this.viewport;
    const ids: TokenId[] = [];
    const tokenBounds: BoundingBox[] = [];
    for (let i = 0; i < this.tokens.length; i++) {
      if (
        !this.isSelectableToken(this.tokens[i], viewport.width, viewport.height)
      )
        continue;

      for (let j = 0; j < selections.length; j++) {
        const normalized_selection_bounds = normalizeBounds(selections[j]);
        const tokenBound = this.getTokenBounds(this.tokens[i]);

        if (
          doOverlap(scaled(tokenBound, this.scale), normalized_selection_bounds)
        ) {
          ids.push({ pageIndex: this.page.pageNumber - 1, tokenIndex: i });
          tokenBounds.push(tokenBound);
          break;
        }
      }
    }
    if (ids.length === 0) {
      return {
        bounds: {
          top: 0,
          bottom: 0,
          left: 0,
          right: 0,
        },
        tokensJsons: [],
        rawText: "",
      };
    }
    const bounds = spanningBound(tokenBounds);
    const rawText = convertAnnotationTokensToText([this], 0, ids);

    return {
      bounds,
      tokensJsons: ids,
      rawText,
    };
  }

  /**
   * The box around those of `selected_tokens` that are on this page and are
   * selectable; undefined when there are none. (A token index the page does
   * not have is skipped.)
   */
  getBoundsForTokens(selected_tokens: TokenId[]): Optional<BoundingBox> {
    const this_page_tokens = selected_tokens.filter(
      (token) => token.pageIndex === this.page.pageNumber - 1
    );

    const viewport = this.viewport;
    const tokenBounds: BoundingBox[] = [];
    for (let i = 0; i < this_page_tokens.length; i++) {
      const token = this.tokens[this_page_tokens[i].tokenIndex];
      if (
        !token ||
        !this.isSelectableToken(token, viewport.width, viewport.height)
      )
        continue;

      tokenBounds.push(this.getTokenBounds(token));
    }
    if (tokenBounds.length === 0) return undefined;

    return spanningBound(tokenBounds);
  }

  getScaledTokenBounds(t: PawlsToken): BoundingBox {
    if (typeof t === "undefined") {
      return undefined_bounding_box;
    }
    return this.getScaledBounds(this.getTokenBounds(t));
  }

  getTokenBounds(t: PawlsToken): BoundingBox {
    if (!t) {
      return {
        left: 0,
        top: 0,
        right: 0,
        bottom: 0,
      };
    } else {
      return {
        left: t.x,
        top: t.y,
        right: t.x + t.width,
        bottom: t.y + t.height,
      };
    }
  }

  getScaledBounds(b: BoundingBox): BoundingBox {
    return scaled(b, this.scale);
  }

  // Method to create a new instance with an updated scale
  public withScale(newScale: number): PDFPageInfo {
    return new PDFPageInfo(this.page, this.tokens, newScale);
  }
}

// Given an array of TokenIds, which is what Pawls returns when we annotate tokens,
// Look up those token indices in the page's token array and then append those tokens
// together, separating by spaces. A more sophisticated approach could inspect token
// y-positions to insert newlines, but space-joining is sufficient for current usage.
export const convertAnnotationTokensToText = (
  pages: PDFPageInfo[] | undefined,
  page: number,
  tokens: TokenId[]
): string => {
  const page_tokens = pages ? pages[page].tokens : [];
  const token_indices = tokens.map((token) => token.tokenIndex);

  return page_tokens
    .filter((token, index) => token_indices.includes(index))
    .reduce<string>((acc, cur) => {
      // Handle image tokens and tokens with missing/null text gracefully
      const text = cur?.text ?? "";
      if (!text) {
        return acc;
      }
      return acc.length > 0 ? acc + " " + text : text;
    }, "");
};
