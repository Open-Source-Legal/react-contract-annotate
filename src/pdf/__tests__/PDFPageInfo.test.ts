// Ported from OpenContracts (98286cabf)
// frontend/src/components/annotator/types/__tests__/pdf.test.ts, minus the
// cases for the removed getAnnotationForBounds / getFreeFormAnnotationForBounds.
import type { PDFPageProxy } from "pdfjs-dist/types/src/display/api";
import { describe, expect, it, vi } from "vitest";

import type { BoundingBox, PawlsToken } from "../../core/index";
import { PDFPageInfo } from "../PDFPageInfo";

/**
 * Minimal PDFPageProxy stub for tests that only need pageNumber.
 */
function makeFakePageProxy(pageNumber: number): PDFPageProxy {
  return {
    pageNumber,
    getViewport: vi.fn(({ scale }: { scale: number }) => ({
      width: 612 * scale,
      height: 792 * scale,
    })),
  } as unknown as PDFPageProxy;
}

function makeToken(
  x: number,
  y: number,
  width: number,
  height: number,
  text: string,
  extra: Partial<PawlsToken> = {}
): PawlsToken {
  return { x, y, width, height, text, ...extra };
}

const FULL_PAGE_SELECTION: BoundingBox = {
  left: 0,
  top: 0,
  right: 612,
  bottom: 792,
};

describe("PDFPageInfo", () => {
  describe("phantom / degenerate token filtering", () => {
    it("excludes empty-text page-spanning tokens from getPageAnnotationJson", () => {
      const realToken = makeToken(100, 200, 50, 10, "Hello");
      const phantomToken = makeToken(0, 0, 612, 792, "");

      const pageInfo = new PDFPageInfo(
        makeFakePageProxy(1),
        [realToken, phantomToken],
        1
      );

      const result = pageInfo.getPageAnnotationJson([FULL_PAGE_SELECTION]);

      expect(result.tokensJsons).toHaveLength(1);
      expect(result.tokensJsons[0].tokenIndex).toBe(0);
      expect(result.rawText).toContain("Hello");
      expect(result.bounds.left).toBeGreaterThan(0);
      expect(result.bounds.right).toBeLessThan(612);
    });

    it("excludes page-spanning image tokens (Docling page captures)", () => {
      const realToken = makeToken(100, 200, 50, 10, "Text");
      // Docling emits full-page image tokens with is_image=true
      const pageImage = makeToken(0, 0, 612, 792, "", {
        is_image: true,
        image_path: "/page_capture.jpg",
      });

      const pageInfo = new PDFPageInfo(
        makeFakePageProxy(1),
        [realToken, pageImage],
        1
      );

      const result = pageInfo.getPageAnnotationJson([FULL_PAGE_SELECTION]);

      expect(result.tokensJsons).toHaveLength(1);
      expect(result.tokensJsons[0].tokenIndex).toBe(0);
      // Bounds should wrap only the real token
      expect(result.bounds.right).toBeLessThan(612);
    });

    it("excludes page-spanning tokens from getBoundsForTokens", () => {
      const realToken = makeToken(100, 200, 50, 10, "Real");
      const phantomToken = makeToken(0, 0, 612, 792, "", {
        is_image: true,
      });

      const pageInfo = new PDFPageInfo(
        makeFakePageProxy(1),
        [realToken, phantomToken],
        1
      );

      const selectedTokens = [
        { pageIndex: 0, tokenIndex: 0 },
        { pageIndex: 0, tokenIndex: 1 }, // phantom
      ];

      const bounds = pageInfo.getBoundsForTokens(selectedTokens);

      expect(bounds).toBeDefined();
      expect(bounds!.left).toBeGreaterThan(0);
      expect(bounds!.right).toBeLessThan(612);
    });

    it("includes normal-sized image tokens with empty text", () => {
      const imageToken = makeToken(50, 50, 200, 150, "", {
        is_image: true,
        image_path: "/test.png",
      });

      const pageInfo = new PDFPageInfo(
        makeFakePageProxy(1),
        [imageToken],
        1
      );

      const result = pageInfo.getPageAnnotationJson([FULL_PAGE_SELECTION]);

      expect(result.tokensJsons).toHaveLength(1);
      expect(result.tokensJsons[0].tokenIndex).toBe(0);
    });

    it("excludes whitespace-only text tokens that span the page", () => {
      const realToken = makeToken(100, 200, 50, 10, "Text");
      const whitespaceToken = makeToken(0, 0, 612, 792, "   ");

      const pageInfo = new PDFPageInfo(
        makeFakePageProxy(1),
        [realToken, whitespaceToken],
        1
      );

      const result = pageInfo.getPageAnnotationJson([FULL_PAGE_SELECTION]);

      expect(result.tokensJsons).toHaveLength(1);
      expect(result.tokensJsons[0].tokenIndex).toBe(0);
    });

    it("excludes empty-text non-image tokens even if small", () => {
      const realToken = makeToken(100, 200, 50, 10, "Text");
      const emptySmall = makeToken(50, 50, 20, 10, "");

      const pageInfo = new PDFPageInfo(
        makeFakePageProxy(1),
        [realToken, emptySmall],
        1
      );

      const result = pageInfo.getPageAnnotationJson([FULL_PAGE_SELECTION]);

      expect(result.tokensJsons).toHaveLength(1);
      expect(result.tokensJsons[0].tokenIndex).toBe(0);
    });
  });

  describe("getPageAnnotationJson", () => {
    it("returns empty result when no tokens overlap selection", () => {
      const token = makeToken(100, 200, 50, 10, "Hello");

      const pageInfo = new PDFPageInfo(
        makeFakePageProxy(1),
        [token],
        1
      );

      const selection: BoundingBox = {
        left: 500,
        top: 500,
        right: 600,
        bottom: 600,
      };

      const result = pageInfo.getPageAnnotationJson([selection]);

      expect(result.tokensJsons).toHaveLength(0);
      expect(result.rawText).toBe("");
    });

    it("correctly computes bounds from overlapping tokens", () => {
      const token1 = makeToken(100, 200, 50, 10, "Hello");
      const token2 = makeToken(160, 200, 50, 10, "World");

      const pageInfo = new PDFPageInfo(
        makeFakePageProxy(1),
        [token1, token2],
        1
      );

      const selection: BoundingBox = {
        left: 90,
        top: 190,
        right: 220,
        bottom: 220,
      };

      const result = pageInfo.getPageAnnotationJson([selection]);

      expect(result.tokensJsons).toHaveLength(2);
      // spanningBound adds 3px padding
      expect(result.bounds.left).toBe(100 - 3);
      expect(result.bounds.top).toBe(200 - 3);
      expect(result.bounds.right).toBe(210 + 3);
      expect(result.bounds.bottom).toBe(210 + 3);
    });
  });
});

// Added: the highlight overlay boxes tokens on pages the loader builds
// without `bounds`.
describe("getBoundsForTokens on a page without bounds", () => {
  const tokens = [
    makeToken(10, 10, 20, 5, "Hello"),
    makeToken(35, 10, 20, 5, "world"),
  ];
  const pageInfo = () => new PDFPageInfo(makeFakePageProxy(1), tokens, 1);

  it("boxes the tokens it is given, padded", () => {
    expect(
      pageInfo().getBoundsForTokens([
        { pageIndex: 0, tokenIndex: 0 },
        { pageIndex: 0, tokenIndex: 1 },
      ])
    ).toEqual({ left: 7, top: 7, right: 58, bottom: 18 });
  });

  it("skips a token index the page does not have", () => {
    expect(
      pageInfo().getBoundsForTokens([
        { pageIndex: 0, tokenIndex: 99 },
        { pageIndex: 0, tokenIndex: 1 },
      ])
    ).toEqual({ left: 32, top: 7, right: 58, bottom: 18 });
  });

  it("is undefined when no token qualifies", () => {
    expect(pageInfo().getBoundsForTokens([])).toBeUndefined();
    expect(
      pageInfo().getBoundsForTokens([{ pageIndex: 0, tokenIndex: 99 }])
    ).toBeUndefined();
    expect(
      pageInfo().getBoundsForTokens([{ pageIndex: 3, tokenIndex: 0 }])
    ).toBeUndefined();
  });
});

// Added: text selection builds drafts on the pages the loader builds without
// `bounds`; the selection is in the page's coordinates at its scale.
describe("getPageAnnotationJson on a page without bounds", () => {
  const tokens = [
    makeToken(10, 10, 20, 5, "Hello"),
    makeToken(35, 10, 20, 5, "world"),
    makeToken(10, 30, 20, 5, "again"),
  ];
  /** Overlaps "Hello" and "world" at scale 1. */
  const SELECTION: BoundingBox = { left: 12, top: 11, right: 50, bottom: 14 };

  it.each([1, 1.5])(
    "selects the same tokens at scale %s, with unscaled bounds",
    (scale) => {
      const pageInfo = new PDFPageInfo(makeFakePageProxy(1), tokens, scale);
      const atScale: BoundingBox = {
        left: SELECTION.left * scale,
        top: SELECTION.top * scale,
        right: SELECTION.right * scale,
        bottom: SELECTION.bottom * scale,
      };

      expect(pageInfo.getPageAnnotationJson([atScale])).toEqual({
        bounds: { left: 7, top: 7, right: 58, bottom: 18 },
        tokensJsons: [
          { pageIndex: 0, tokenIndex: 0 },
          { pageIndex: 0, tokenIndex: 1 },
        ],
        rawText: "Hello world",
      });
    }
  );
});
