/**
 * Measurements of what an annotator renders, read from the DOM contract:
 * each mounted page is `[data-rca-page="<index>"]` holding one `<canvas>`;
 * an annotation's box on a page is
 * `[data-rca-annotation="<id>"][data-rca-page-part="<index>"]` and its token
 * rects are `[data-rca-token="<id>"]`.
 */
import type { Locator } from "@playwright/test";

/** A rectangle in CSS px. */
export type Rect = { left: number; top: number; width: number; height: number };

/** How often `settledScrollTop` samples, and how many equal samples it wants. */
const SCROLL_SAMPLE_MS = 100;
const SCROLL_STABLE_SAMPLES = 3;

/** The box an annotation draws on a page. */
export function annotationBox(
  root: Locator,
  id: string,
  pageIndex: number
): Locator {
  return root.locator(
    `[data-rca-annotation="${id}"][data-rca-page-part="${pageIndex}"]`
  );
}

/** The token rects an annotation draws on a page. */
export function tokenRects(
  root: Locator,
  id: string,
  pageIndex: number
): Locator {
  return root.locator(`[data-rca-page="${pageIndex}"] [data-rca-token="${id}"]`);
}

/** The box of annotation `id` on page `pageIndex`, relative to its canvas. */
export async function boxRelativeToCanvas(
  root: Locator,
  id: string,
  pageIndex: number
): Promise<Rect> {
  const canvas = await pageCanvas(root, pageIndex).boundingBox();
  const box = await annotationBox(root, id, pageIndex).boundingBox();
  if (!canvas || !box) throw new Error(`no box for ${id} on page ${pageIndex}`);
  return {
    left: box.x - canvas.x,
    top: box.y - canvas.y,
    width: box.width,
    height: box.height,
  };
}

/** The token rects of annotation `id` on a page, relative to its canvas. */
export async function tokenRectsRelativeToCanvas(
  root: Locator,
  id: string,
  pageIndex: number
): Promise<Rect[]> {
  const canvas = await pageCanvas(root, pageIndex).boundingBox();
  if (!canvas) throw new Error(`page ${pageIndex} is not mounted`);
  const rects = await tokenRects(root, id, pageIndex).evaluateAll((spans) =>
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
  pageIndex: number
): Promise<{
  top: number;
  bottom: number;
  left: number;
  right: number;
  viewHeight: number;
  viewWidth: number;
}> {
  return root.evaluate(
    (el, [annotationId, part]) => {
      const box = Array.from(
        el.querySelectorAll(`[data-rca-page-part="${part}"]`)
      ).find((candidate) =>
        candidate.getAttribute("data-rca-annotation") === annotationId
      );
      if (!box) throw new Error(`no box for ${annotationId} on page ${part}`);
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
    [id, pageIndex] as const
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
