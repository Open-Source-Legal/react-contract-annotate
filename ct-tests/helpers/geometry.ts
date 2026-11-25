/**
 * Measurements of what an annotator renders, read from the DOM contract:
 * each mounted page is `[data-rca-page="<index>"]` holding one `<canvas>`.
 */
import type { Locator } from "@playwright/test";

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
