/**
 * Measurements of what an annotator renders, read from the DOM contract:
 * each mounted page is `[data-rca-page="<index>"]` holding one `<canvas>`;
 * an annotation's box on a page is
 * `[data-rca-annotation="<id>"][data-rca-page-part="<index>"]` and its token
 * rects are `[data-rca-token="<id>"]`; a highlight's are
 * `[data-rca-highlight="<id>"][data-rca-page-part="<index>"]` and
 * `[data-rca-highlight-token="<id>"]`. The helpers take the `kind` of what
 * they measure (default `"annotation"`).
 */
import { expect } from "@playwright/test";
import type { Locator } from "@playwright/test";

/** A rectangle in CSS px. */
export type Rect = { left: number; top: number; width: number; height: number };

/** Tolerance (px) of measured geometry. */
export const GEOMETRY_TOLERANCE_PX = 1;

/** Expects each edge and size of `actual` to be within a pixel of `expected`. */
export function expectRectClose(actual: Rect, expected: Rect): void {
  for (const key of ["left", "top", "width", "height"] as const) {
    expect(Math.abs(actual[key] - expected[key])).toBeLessThanOrEqual(
      GEOMETRY_TOLERANCE_PX
    );
  }
}

/** How often `settledScrollTop` samples, and how many equal samples it wants. */
const SCROLL_SAMPLE_MS = 100;
const SCROLL_STABLE_SAMPLES = 3;

/** What a box is drawn for. */
export type BoxKind = "annotation" | "highlight";

const BOX_ATTRIBUTE: Record<BoxKind, string> = {
  annotation: "data-rca-annotation",
  highlight: "data-rca-highlight",
};

const TOKEN_ATTRIBUTE: Record<BoxKind, string> = {
  annotation: "data-rca-token",
  highlight: "data-rca-highlight-token",
};

/** The box something draws on a page. */
export function box(
  root: Locator,
  id: string,
  pageIndex: number,
  kind: BoxKind = "annotation"
): Locator {
  return root.locator(
    `[${BOX_ATTRIBUTE[kind]}="${id}"][data-rca-page-part="${pageIndex}"]`
  );
}

/** The box an annotation draws on a page. */
export function annotationBox(
  root: Locator,
  id: string,
  pageIndex: number
): Locator {
  return box(root, id, pageIndex, "annotation");
}

/** The box a highlight draws on a page. */
export function highlightBox(
  root: Locator,
  id: string,
  pageIndex: number
): Locator {
  return box(root, id, pageIndex, "highlight");
}

/** The token rects an annotation (or highlight) draws on a page. */
export function tokenRects(
  root: Locator,
  id: string,
  pageIndex: number,
  kind: BoxKind = "annotation"
): Locator {
  return root.locator(
    `[data-rca-page="${pageIndex}"] [${TOKEN_ATTRIBUTE[kind]}="${id}"]`
  );
}

/** The box of `id` on page `pageIndex`, relative to its canvas. */
export async function boxRelativeToCanvas(
  root: Locator,
  id: string,
  pageIndex: number,
  kind: BoxKind = "annotation"
): Promise<Rect> {
  const canvas = await pageCanvas(root, pageIndex).boundingBox();
  const measured = await box(root, id, pageIndex, kind).boundingBox();
  if (!canvas || !measured) {
    throw new Error(`no box for ${id} on page ${pageIndex}`);
  }
  return {
    left: measured.x - canvas.x,
    top: measured.y - canvas.y,
    width: measured.width,
    height: measured.height,
  };
}

/** The token rects of `id` on a page, relative to its canvas. */
export async function tokenRectsRelativeToCanvas(
  root: Locator,
  id: string,
  pageIndex: number,
  kind: BoxKind = "annotation"
): Promise<Rect[]> {
  const canvas = await pageCanvas(root, pageIndex).boundingBox();
  if (!canvas) throw new Error(`page ${pageIndex} is not mounted`);
  const rects = await tokenRects(root, id, pageIndex, kind).evaluateAll((spans) =>
    spans.map((span) => {
      const { x, y, width, height } = span.getBoundingClientRect();
      return { x, y, width, height };
    })
  );
  return rects.map(({ x, y, width, height }) => ({
    left: x - canvas.x,
    top: y - canvas.y,
    width,
    height,
  }));
}

/**
 * Where the box of `id` on a page is in the root's view: its edges relative
 * to the top left of the root's client area, and that area's size.
 */
export async function boxInRootView(
  root: Locator,
  id: string,
  pageIndex: number,
  kind: BoxKind = "annotation"
): Promise<{
  top: number;
  bottom: number;
  left: number;
  right: number;
  viewHeight: number;
  viewWidth: number;
}> {
  return root.evaluate(
    (el, [boxId, part, attribute]) => {
      const box = Array.from(
        el.querySelectorAll(`[data-rca-page-part="${part}"]`)
      ).find((candidate) => candidate.getAttribute(attribute) === boxId);
      if (!box) throw new Error(`no box for ${boxId} on page ${part}`);
      const view = el.getBoundingClientRect();
      const viewTop = view.top + el.clientTop;
      const viewLeft = view.left + el.clientLeft;
      const rect = box.getBoundingClientRect();
      return {
        top: rect.top - viewTop,
        bottom: rect.bottom - viewTop,
        left: rect.left - viewLeft,
        right: rect.right - viewLeft,
        viewHeight: el.clientHeight,
        viewWidth: el.clientWidth,
      };
    },
    [id, pageIndex, BOX_ATTRIBUTE[kind]] as const
  );
}

/** The root's `scrollTop` once it has stopped changing (smooth scrolls end). */
export async function settledScrollTop(root: Locator): Promise<number> {
  let last = await root.evaluate((el) => el.scrollTop);
  let stable = 0;
  while (stable < SCROLL_STABLE_SAMPLES) {
    await root.page().waitForTimeout(SCROLL_SAMPLE_MS);
    const next = await root.evaluate((el) => el.scrollTop);
    stable = next === last ? stable + 1 : 0;
    last = next;
  }
  return last;
}

/** Indices of the mounted pages, ascending. */
export async function mountedPages(root: Locator): Promise<number[]> {
  const indices = await root
    .locator("[data-rca-page]")
    .evaluateAll((pages) =>
      pages.map((page) => Number(page.getAttribute("data-rca-page")))
    );
  return indices.sort((a, b) => a - b);
}

/** The canvas of a mounted page. */
export function pageCanvas(root: Locator, pageIndex: number): Locator {
  return root.locator(`[data-rca-page="${pageIndex}"] canvas`);
}

/** The backing-store size of a mounted page's canvas (CSS px at zoom). */
export async function canvasSize(
  root: Locator,
  pageIndex: number
): Promise<{ width: number; height: number }> {
  return pageCanvas(root, pageIndex).evaluate((canvas) => ({
    width: (canvas as HTMLCanvasElement).width,
    height: (canvas as HTMLCanvasElement).height,
  }));
}
