/**
 * Parity with OpenContracts: for the eton fixture, the box and token
 * rectangles the library draws land where OpenContracts' own renderer
 * (`SelectionBoundary` / `SelectionTokenGroup`, 98286cabf) puts them, at two
 * zoom levels. The reference is `fixtures/parity/eton.json`, captured by
 * `scripts/parity/capture.test.tsx` running in an OpenContracts checkout; it
 * is never edited by hand. A mismatch here is a porting bug in the PDF
 * geometry, not a reason to change the fixture.
 *
 * The library side draws through `AnnotationBox` (which composes
 * `SelectionBoundary` and `TokenGroup` and derives the box's bounds from the
 * annotation exactly as OpenContracts' `Selection` does), inside an
 * `AnnotatorShell`, which owns the instance store (`AnnotatorProvider`) the
 * annotation is normalised into. Pages are built the way the loader builds
 * them: PAWLS expanded, tokens resolved against a pdf.js page of the PAWLS
 * page's size.
 */
import { render } from "@testing-library/react";
import type { PDFPageProxy } from "pdfjs-dist/types/src/display/api";

import {
  AnnotatorShell,
  expandPawlsPages,
  resolvePageTokens,
  useVisibleAnnotations,
} from "../../core/index";
import type { Annotation, PawlsInput } from "../../core/index";
import annotationsJson from "../../../fixtures/eton/annotations.json";
import pawlsJson from "../../../fixtures/eton/pawls.json";
import parityJson from "../../../fixtures/parity/eton.json";
import { AnnotationBox } from "../AnnotationBox";
import { PDFPageInfo } from "../PDFPageInfo";

interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface ParityCase {
  id: string;
  pageIndex: number;
  zoom: number;
  boundary: Rect;
  tokens: Rect[];
}

const { commit, cases } = parityJson as unknown as {
  commit: string;
  cases: ParityCase[];
};

const ANNOTATIONS = annotationsJson as unknown as Annotation[];
const PAWLS_PAGES = expandPawlsPages(pawlsJson as unknown as PawlsInput);

/** The same stub the capture uses: the PAWLS page's size times the scale. */
function stubPage(pageIndex: number): PDFPageProxy {
  const { width, height } = PAWLS_PAGES[pageIndex].page;
  return {
    pageNumber: pageIndex + 1,
    getViewport: ({ scale }: { scale: number }) => ({
      width: width * scale,
      height: height * scale,
    }),
  } as unknown as PDFPageProxy;
}

function pageAt(pageIndex: number, zoom: number): PDFPageInfo {
  const page = stubPage(pageIndex);
  const viewport = page.getViewport({ scale: 1 });
  const tokens = resolvePageTokens(
    PAWLS_PAGES,
    pageIndex,
    viewport.width,
    viewport.height,
    pageIndex + 1
  );
  return new PDFPageInfo(page, tokens, zoom);
}

/** Draws the annotations the shell shows on one page, as a page does. */
function Boxes({ info }: { info: PDFPageInfo }) {
  const annotations = useVisibleAnnotations();
  return (
    <>
      {annotations.map((annotation) =>
        annotation.kind === "token" ? (
          <AnnotationBox
            key={annotation.id}
            annotation={annotation}
            pageInfo={info}
          />
        ) : null
      )}
    </>
  );
}

/** The inline `left` / `top` / `width` / `height` of an element, in px. */
function rectOf(element: HTMLElement): Rect {
  return {
    left: parseFloat(element.style.left),
    top: parseFloat(element.style.top),
    width: parseFloat(element.style.width),
    height: parseFloat(element.style.height),
  };
}

function expectRect(actual: Rect, expected: Rect): void {
  expect(actual.left).toBeCloseTo(expected.left, 3);
  expect(actual.top).toBeCloseTo(expected.top, 3);
  expect(actual.width).toBeCloseTo(expected.width, 3);
  expect(actual.height).toBeCloseTo(expected.height, 3);
}

describe("parity with OpenContracts (eton fixture)", () => {
  it("compares the captured cases, from the expected commit", () => {
    expect(commit).toBe("98286cabf");
    // Guards against a capture that compares nothing.
    expect(cases).toHaveLength(10);
    expect(new Set(cases.map((c) => c.zoom))).toEqual(new Set([1, 1.5]));
    expect(new Set(cases.map((c) => c.id))).toEqual(
      new Set(["a-title", "a-compact", "a-multi", "a-far"])
    );
    expect(
      cases.filter((c) => c.id === "a-multi").map((c) => c.pageIndex)
    ).toEqual(expect.arrayContaining([3, 4]));
    for (const c of cases) expect(c.tokens.length).toBeGreaterThan(0);
  });

  test.each(cases)(
    "$id page $pageIndex @ $zoom matches OpenContracts",
    ({ id, pageIndex, zoom, boundary, tokens }) => {
      const annotation = ANNOTATIONS.find((a) => a.id === id);
      expect(annotation, `annotation ${id} is in the fixture`).toBeDefined();

      const { container } = render(
        <AnnotatorShell
          common={{ annotations: [annotation as Annotation], zoom }}
          handleRef={null}
        >
          <Boxes info={pageAt(pageIndex, zoom)} />
        </AnnotatorShell>
      );

      const boxes = container.querySelectorAll<HTMLElement>(
        `[data-rca-annotation="${id}"][data-rca-page-part="${pageIndex}"]`
      );
      expect(boxes).toHaveLength(1);
      expectRect(rectOf(boxes[0]), boundary);

      const rects = Array.from(
        container.querySelectorAll<HTMLElement>(`[data-rca-token="${id}"]`)
      ).map(rectOf);
      expect(rects).toHaveLength(tokens.length);
      tokens.forEach((expected, i) => expectRect(rects[i], expected));
    }
  );
});
