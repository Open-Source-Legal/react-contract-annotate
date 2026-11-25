import { expect, test } from "@playwright/experimental-ct-react";

import { PdfHarness } from "./wrappers/PdfHarness";

import { serveFixtures } from "./helpers/fixtures";
import { canvasSize, mountedPages } from "./helpers/geometry";
import {
  annotatorRoot,
  callHandle,
  harnessEvents,
  waitForDocumentLoad,
} from "./helpers/harness";

/** The harness is 900 px wide; fit-to-width keeps a 16 px margin. */
const HARNESS_WIDTH = 900;
const FIT_MARGIN = 16;
/** Slack for a vertical scrollbar taking part of the width. */
const SCROLLBAR_SLACK = 40;
/** Natural width of the eton fixture's pages (pdf.js, scale 1). */
const ETON_PAGE_WIDTH = 595;
const ETON_PAGE_COUNT = 23;
/** Longer than the viewport's shared render debounce. */
const RENDER_SETTLE_MS = 400;

/** Console errors and warnings, and uncaught errors, of the current test. */
const consoleProblems: string[] = [];

test.beforeEach(async ({ page }) => {
  consoleProblems.length = 0;
  page.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning") {
      consoleProblems.push(`[${message.type()}] ${message.text()}`);
    }
  });
  page.on("pageerror", (error) => consoleProblems.push(error.message));
  await serveFixtures(page);
});

test.afterEach(() => {
  // Render failures (and React warnings) only show up in the console.
  expect(consoleProblems).toEqual([]);
});

test("renders the first pages and virtualises the rest", async ({
  mount,
  page,
}) => {
  await mount(<PdfHarness />);
  await waitForDocumentLoad(page);
  const root = annotatorRoot(page);

  expect(await callHandle(page, "getPageCount", [])).toBe(ETON_PAGE_COUNT);
  await expect.poll(() => mountedPages(root)).toContain(0);
  const mounted = await mountedPages(root);
  expect(mounted.length).toBeGreaterThanOrEqual(1);
  expect(mounted.length).toBeLessThanOrEqual(6);
  await expect.poll(async () => (await canvasSize(root, 0)).width).toBeGreaterThan(0);
});

test("default zoom fits width", async ({ mount, page }) => {
  await mount(<PdfHarness />);
  await waitForDocumentLoad(page);
  const root = annotatorRoot(page);

  await expect
    .poll(async () => (await canvasSize(root, 0)).width)
    .toBeGreaterThanOrEqual(HARNESS_WIDTH - FIT_MARGIN - SCROLLBAR_SLACK);
  expect((await canvasSize(root, 0)).width).toBeLessThanOrEqual(
    HARNESS_WIDTH - FIT_MARGIN
  );
  const zoom = await callHandle(page, "getZoom", []);
  expect(zoom).toBeGreaterThanOrEqual(0.5);
  expect(zoom).toBeLessThanOrEqual(4);
});

test("uncontrolled zoom: handle.setZoom(1.5) resizes the canvas and fires onZoomChange(1.5)", async ({
  mount,
  page,
}) => {
  await mount(<PdfHarness />);
  await waitForDocumentLoad(page);
  const root = annotatorRoot(page);
  await expect.poll(() => mountedPages(root)).toContain(0);

  await callHandle(page, "setZoom", [1.5]);

  await expect
    .poll(async () => (await canvasSize(root, 0)).width)
    .toBe(Math.floor(ETON_PAGE_WIDTH * 1.5));
  const zoomEvents = await harnessEvents(page, "onZoomChange");
  expect(zoomEvents.at(-1)).toEqual(["onZoomChange", 1.5]);
  expect(await callHandle(page, "getZoom", [])).toBe(1.5);
});

test("controlled zoom: handle.zoomIn() fires onZoomChange but canvas width is unchanged until the prop changes", async ({
  mount,
  page,
}) => {
  const component = await mount(
    <PdfHarness mode="controlled" props={{ zoom: 1 }} />
  );
  await waitForDocumentLoad(page);
  const root = annotatorRoot(page);
  await expect
    .poll(async () => (await canvasSize(root, 0)).width)
    .toBe(ETON_PAGE_WIDTH);

  await callHandle(page, "zoomIn", []);

  await expect
    .poll(() => harnessEvents(page, "onZoomChange"))
    .toEqual([["onZoomChange", 1.1]]);
  await page.waitForTimeout(RENDER_SETTLE_MS);
  expect((await canvasSize(root, 0)).width).toBe(ETON_PAGE_WIDTH);
  expect(await callHandle(page, "getZoom", [])).toBe(1);

  await component.update(<PdfHarness mode="controlled" props={{ zoom: 1.1 }} />);

  await expect
    .poll(async () => (await canvasSize(root, 0)).width)
    .toBe(Math.floor(ETON_PAGE_WIDTH * 1.1));
  expect(await callHandle(page, "getZoom", [])).toBe(1.1);
});

test("scrollToPage(12) mounts page 12 and reports it in getVisiblePageRange()", async ({
  mount,
  page,
}) => {
  await mount(<PdfHarness />);
  await waitForDocumentLoad(page);
  const root = annotatorRoot(page);
  await expect.poll(() => mountedPages(root)).toContain(0);

  expect(await callHandle(page, "scrollToPage", [12])).toBe(true);

  await expect.poll(() => mountedPages(root)).toContain(12);
  await expect
    .poll(async () => {
      const range = await callHandle(page, "getVisiblePageRange", []);
      return range !== null && range[0] <= 12 && 12 <= range[1];
    })
    .toBe(true);
  expect(await mountedPages(root)).not.toContain(0);
  expect(await callHandle(page, "scrollToPage", [ETON_PAGE_COUNT])).toBe(false);
});

test("the page of a selected annotation stays mounted while it is out of view", async ({
  mount,
  page,
}) => {
  await mount(<PdfHarness annotationIds={["a-far"]} />);
  await waitForDocumentLoad(page);
  const root = annotatorRoot(page);
  await expect.poll(() => mountedPages(root)).toContain(0);
  expect(await mountedPages(root)).not.toContain(17);

  await callHandle(page, "selectAnnotations", [["a-far"], { scroll: false }]);

  await expect.poll(() => mountedPages(root)).toContain(17);
  expect(await mountedPages(root)).toContain(0);
  expect(await callHandle(page, "getVisiblePageRange", [])).toEqual([0, 0]);

  await callHandle(page, "clearSelection", []);
  await expect.poll(() => mountedPages(root)).not.toContain(17);
});

test("onDocumentLoad fires once with pageCount 23 and non-empty text; onVisiblePagesChange fires on scroll", async ({
  mount,
  page,
}) => {
  await mount(<PdfHarness />);
  await waitForDocumentLoad(page);
  const root = annotatorRoot(page);

  const loads = await harnessEvents(page, "onDocumentLoad");
  expect(loads).toHaveLength(1);
  const [, info] = loads[0] as [string, { pageCount: number; text: string }];
  expect(info.pageCount).toBe(ETON_PAGE_COUNT);
  expect(info.text.length).toBeGreaterThan(0);
  expect(info.text).toBe(await callHandle(page, "getText", []));

  await expect
    .poll(() => harnessEvents(page, "onVisiblePagesChange"))
    .toEqual([["onVisiblePagesChange", [0, 0]]]);

  await root.evaluate((el) => {
    el.scrollTop = el.scrollHeight / 2;
  });

  await expect
    .poll(async () => {
      const changes = await harnessEvents(page, "onVisiblePagesChange");
      const [, range] = changes.at(-1) as [string, [number, number]];
      return range[0];
    })
    .toBeGreaterThan(0);
  expect(await harnessEvents(page, "onDocumentLoad")).toHaveLength(1);
});

test("two viewers: zooming the left one does not resize the right one's canvases", async ({
  mount,
  page,
}) => {
  await page.setViewportSize({ width: 2 * HARNESS_WIDTH + 100, height: 900 });
  await mount(
    <div style={{ display: "flex" }}>
      <PdfHarness name="left" />
      <PdfHarness name="right" />
    </div>
  );
  await waitForDocumentLoad(page, "left");
  await waitForDocumentLoad(page, "right");
  const left = annotatorRoot(page, "left");
  const right = annotatorRoot(page, "right");
  await expect.poll(() => mountedPages(right)).toContain(0);
  await expect.poll(async () => (await canvasSize(right, 0)).width).toBeGreaterThan(0);
  const rightBefore = await canvasSize(right, 0);
  const rightZoomBefore = await callHandle(page, "getZoom", [], "right");

  await callHandle(page, "setZoom", [2], "left");

  await expect
    .poll(async () => (await canvasSize(left, 0)).width)
    .toBe(ETON_PAGE_WIDTH * 2);
  await page.waitForTimeout(RENDER_SETTLE_MS);
  expect(await canvasSize(right, 0)).toEqual(rightBefore);
  expect(await callHandle(page, "getZoom", [], "right")).toBe(rightZoomBefore);
  expect(await harnessEvents(page, "onZoomChange", "right")).not.toContainEqual([
    "onZoomChange",
    2,
  ]);
});

test("switching to a document that never loads and back reloads the first one cleanly", async ({
  mount,
  page,
}) => {
  // Registered after `serveFixtures`, so it wins: the usc PDF never arrives.
  await page.route("**/fixtures/usc/usc-title-1.pdf", () => {});
  const loadedPageCounts = async () =>
    (await harnessEvents(page, "onDocumentLoad")).map(
      ([, info]) => (info as { pageCount: number }).pageCount
    );
  const component = await mount(<PdfHarness />);
  await waitForDocumentLoad(page);
  const root = annotatorRoot(page);
  await expect.poll(() => mountedPages(root)).toContain(0);

  const uscRequested = page.waitForRequest("**/fixtures/usc/usc-title-1.pdf");
  await component.update(<PdfHarness fixture="usc" withPawls={false} />);
  await uscRequested;
  await expect.poll(() => mountedPages(root)).toEqual([]);

  await component.update(<PdfHarness />);

  await expect.poll(loadedPageCounts).toEqual([ETON_PAGE_COUNT, ETON_PAGE_COUNT]);
  await expect.poll(() => mountedPages(root)).toContain(0);
  await expect
    .poll(async () => (await canvasSize(root, 0)).width)
    .toBeGreaterThan(0);
  // Let any render of a stale page fail before checking.
  await page.waitForTimeout(RENDER_SETTLE_MS);
  expect(await harnessEvents(page, "onError")).toEqual([]);
  expect(await loadedPageCounts()).toEqual([ETON_PAGE_COUNT, ETON_PAGE_COUNT]);
});

test("switching documents while pages render reports no error and loads the new one", async ({
  mount,
  page,
}) => {
  const loadedPageCounts = async () =>
    (await harnessEvents(page, "onDocumentLoad")).map(
      ([, info]) => (info as { pageCount: number }).pageCount
    );
  const component = await mount(<PdfHarness />);
  await waitForDocumentLoad(page);

  // The first renders of the mounted pages are in flight when the old
  // document's loading task is destroyed.
  await component.update(<PdfHarness fixture="usc" withPawls={false} />);
  await expect.poll(loadedPageCounts).toEqual([ETON_PAGE_COUNT, 9]);

  // Now zoom re-renders are in flight.
  await callHandle(page, "setZoom", [2]);
  await component.update(<PdfHarness />);
  await expect.poll(loadedPageCounts).toEqual([ETON_PAGE_COUNT, 9, ETON_PAGE_COUNT]);

  await expect
    .poll(async () => (await canvasSize(annotatorRoot(page), 0)).width)
    .toBe(ETON_PAGE_WIDTH * 2);
  expect(await harnessEvents(page, "onError")).toEqual([]);
});

test("usc fixture without pawls renders pages", async ({ mount, page }) => {
  await mount(<PdfHarness fixture="usc" withPawls={false} />);
  await waitForDocumentLoad(page);
  const root = annotatorRoot(page);

  expect(await callHandle(page, "getPageCount", [])).toBe(9);
  await expect.poll(() => mountedPages(root)).toContain(0);
  await expect.poll(async () => (await canvasSize(root, 0)).width).toBeGreaterThan(0);
  expect(await callHandle(page, "getText", [])).toBe("");
});

test("mounted hidden (display:none) then shown: zoom becomes a finite fit-width value", async ({
  mount,
  page,
}) => {
  const component = await mount(
    <PdfHarness props={{ style: { display: "none" } }} />
  );
  await waitForDocumentLoad(page);
  // Hidden, the root has no width, so fit-to-width cannot be resolved yet.
  expect(await callHandle(page, "getZoom", [])).toBe(1);

  await component.update(<PdfHarness props={{ style: {} }} />);

  const root = annotatorRoot(page);
  const clientWidth = await root.evaluate((el) => el.clientWidth);
  await expect
    .poll(() => callHandle(page, "getZoom", []))
    .toBeCloseTo((clientWidth - FIT_MARGIN) / ETON_PAGE_WIDTH, 5);
  const zoom = await callHandle(page, "getZoom", []);
  expect(Number.isFinite(zoom)).toBe(true);
  await expect
    .poll(async () => (await canvasSize(root, 0)).width)
    .toBe(Math.floor(ETON_PAGE_WIDTH * zoom));
});

test("only pages and canvases are rendered: no buttons, inputs or menus in the root", async ({
  mount,
  page,
}) => {
  await mount(<PdfHarness />);
  await waitForDocumentLoad(page);
  const root = annotatorRoot(page);
  await expect.poll(() => mountedPages(root)).toContain(0);

  await expect(
    root.locator("button, input, select, [role=menu], [role=dialog]")
  ).toHaveCount(0);
  const pages = await mountedPages(root);
  await expect(root.locator("canvas")).toHaveCount(pages.length);
});
