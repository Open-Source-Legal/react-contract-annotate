import { expect, test } from "@playwright/experimental-ct-react";
import type { Page } from "@playwright/test";

import { PdfHarness } from "./wrappers/PdfHarness";

import type {
  Annotation,
  AnnotationDraft,
  AnnotationLabel,
  MultipageAnnotationJson,
  PendingSelection,
} from "../src/core/index";
import { serveFixtures } from "./helpers/fixtures";
import {
  annotationBox,
  boxRelativeToCanvas,
  drag,
  DRAG_START_FRACTION,
  dragOverTokens,
  dragRegions,
  expectRectClose,
  GEOMETRY_TOLERANCE_PX,
  mountedPages,
  pageCanvas,
  pagePoint,
  pendingRegion,
  SELECTION_ID,
  settledScrollTop,
  tokenPoint,
  tokenRects,
} from "./helpers/geometry";
import type { Rect } from "./helpers/geometry";
import {
  annotatorRoot,
  callHandle,
  harnessEvents,
  waitForDocumentLoad,
} from "./helpers/harness";

/** The label an annotator in "annotate" mode applies. */
const ACTIVE: AnnotationLabel = {
  id: "l-active",
  text: "Active",
  color: "#16a34a",
};
/** Tokens 0 and 1 of page 0: the "Exhibit 10.1" title. */
const TITLE_TOKENS = [
  { pageIndex: 0, tokenIndex: 0 },
  { pageIndex: 0, tokenIndex: 1 },
];
const TITLE_TEXT = "Exhibit 10.1";
/** Longer than the viewport's shared render debounce. */
const RENDER_SETTLE_MS = 400;
/** How far from the release point the selection menu's corner may be. */
const MENU_NEAR_PX = 30;
/** A page far below page 0, so page 0 leaves the virtual window. */
const FAR_PAGE = 15;
/** The left margin of page 0 (page coordinates): no token is there. */
const MARGIN_FROM = { x: 5, y: 300 };
const MARGIN_TO = { x: 40, y: 360 };
/** A point in that margin, for a click on the blank page. */
const MARGIN_POINT = { x: 20, y: 330 };

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

/** The pending selections `onTextSelect` has reported, in order. */
async function textSelections(page: Page): Promise<PendingSelection[]> {
  return (await harnessEvents(page, "onTextSelect")).map(
    ([, pending]) => pending as PendingSelection
  );
}

/** The drafts `onCreateAnnotation` has received, in order. */
async function createdDrafts(page: Page): Promise<AnnotationDraft[]> {
  return (await harnessEvents(page, "onCreateAnnotation")).map(
    ([, draft]) => draft as AnnotationDraft
  );
}

/** Waits for the harness to load and page `pageIndex` to be mounted. */
async function ready(page: Page, pageIndex = 0): Promise<void> {
  await waitForDocumentLoad(page);
  await expect(pageCanvas(annotatorRoot(page), pageIndex)).toHaveCount(1);
}

/** The v1 JSON of one page of a draft. */
function pageJson(draft: AnnotationDraft, pageIndex: number) {
  return (draft.json as MultipageAnnotationJson)[pageIndex];
}

/** `bounds` scaled by `zoom`, as a rect. */
function scaledRect(
  bounds: { top: number; left: number; right: number; bottom: number },
  zoom: number
): Rect {
  return {
    left: bounds.left * zoom,
    top: bounds.top * zoom,
    width: (bounds.right - bounds.left) * zoom,
    height: (bounds.bottom - bounds.top) * zoom,
  };
}

/** The selection changes the user made, with their ids. */
async function userSelectionChanges(page: Page): Promise<unknown[][]> {
  return (await harnessEvents(page, "onSelectionChange"))
    .filter(([, , info]) => (info as { source: string }).source === "user")
    .map(([, ids, info]) => [ids, info]);
}

/** Scrolls page `pageIndex` to the top of the view at once and lets it settle. */
async function scrollToPage(page: Page, pageIndex: number): Promise<void> {
  expect(
    await callHandle(page, "scrollToPage", [pageIndex, { behavior: "instant" }])
  ).toBe(true);
  await settledScrollTop(annotatorRoot(page));
}

test("drag over tokens 0-1 of page 0 -> onTextSelect pending.rawText 'Exhibit 10.1', tokensJsons [0,1], page 0", async ({
  mount,
  page,
}) => {
  await mount(<PdfHarness annotationIds={[]} />);
  await ready(page);
  const root = annotatorRoot(page);

  const { to } = await dragOverTokens(page, 0, 0, 1);

  await expect.poll(async () => (await textSelections(page)).length).toBe(1);
  const [pending] = await textSelections(page);
  expect(pending.rawText).toBe(TITLE_TEXT);
  expect(pending.page).toBe(0);
  expect(pending.annotationLabel).toBeNull();
  expect(Object.keys(pending.json)).toEqual(["0"]);
  expect(pageJson(pending, 0).tokensJsons).toEqual(TITLE_TOKENS);
  // Anchored where the mouse was released.
  expect(Math.abs(pending.anchor.x - to.x)).toBeLessThanOrEqual(
    GEOMETRY_TOLERANCE_PX
  );
  expect(Math.abs(pending.anchor.y - to.y)).toBeLessThanOrEqual(
    GEOMETRY_TOLERANCE_PX
  );

  // Painted as pending: its box on its tokens, and their rects.
  await expect(pendingRegion(root, 0)).toHaveCount(1);
  const zoom = await callHandle(page, "getZoom", []);
  expectRectClose(
    await boxRelativeToCanvas(root, SELECTION_ID, 0, "pending"),
    scaledRect(pageJson(pending, 0).bounds, zoom)
  );
  await expect(tokenRects(root, SELECTION_ID, 0, "pending")).toHaveCount(2);
});

test("outcome 2: activeLabel set -> onCreateAnnotation with that label; no pending region left", async ({
  mount,
  page,
}) => {
  await mount(<PdfHarness annotationIds={[]} props={{ activeLabel: ACTIVE }} />);
  await ready(page);
  const root = annotatorRoot(page);

  await dragOverTokens(page, 0, 0, 1);

  await expect.poll(async () => (await createdDrafts(page)).length).toBe(1);
  const [draft] = await createdDrafts(page);
  expect(draft.annotationLabel).toEqual(ACTIVE);
  expect(draft.rawText).toBe(TITLE_TEXT);
  expect(draft.page).toBe(0);
  expect(pageJson(draft, 0).tokensJsons).toEqual(TITLE_TOKENS);
  expect(await textSelections(page)).toHaveLength(1);
  await expect(pendingRegion(root, 0)).toHaveCount(0);
  expect(await callHandle(page, "getPendingSelection", [])).toBeNull();
});

test("outcome 1: renderSelectionMenu -> menu visible near the mouse-up point; clicking its Apply calls onCreateAnnotation; region clears", async ({
  mount,
  page,
}) => {
  await mount(<PdfHarness annotationIds={[]} selectionMenu />);
  await ready(page);
  const root = annotatorRoot(page);

  const { to } = await dragOverTokens(page, 0, 0, 1);

  const menu = page.locator("[data-rca-selection-menu]");
  await expect(menu).toBeVisible();
  await expect(pendingRegion(root, 0)).toHaveCount(1);
  expect(await createdDrafts(page)).toEqual([]);
  const corner = await menu.boundingBox();
  if (!corner) throw new Error("the menu has no box");
  expect(Math.abs(corner.x - to.x)).toBeLessThanOrEqual(MENU_NEAR_PX);
  expect(Math.abs(corner.y - to.y)).toBeLessThanOrEqual(MENU_NEAR_PX);

  await menu.locator("[data-harness-apply]").click();

  await expect.poll(async () => (await createdDrafts(page)).length).toBe(1);
  const [draft] = await createdDrafts(page);
  expect(draft.rawText).toBe(TITLE_TEXT);
  expect(pageJson(draft, 0).tokensJsons).toEqual(TITLE_TOKENS);
  await expect(pendingRegion(root, 0)).toHaveCount(0);
  await expect(menu).toHaveCount(0);
});

test("outcome 3: nothing configured -> region stays; handle.clearPendingSelection() removes it", async ({
  mount,
  page,
}) => {
  await mount(<PdfHarness annotationIds={[]} />);
  await ready(page);
  const root = annotatorRoot(page);

  await dragOverTokens(page, 0, 0, 1);

  await expect(pendingRegion(root, 0)).toHaveCount(1);
  expect(await createdDrafts(page)).toEqual([]);
  const pending = await callHandle(page, "getPendingSelection", []);
  expect(pending?.rawText).toBe(TITLE_TEXT);

  await callHandle(page, "clearPendingSelection", []);

  await expect(pendingRegion(root, 0)).toHaveCount(0);
  await expect(tokenRects(root, SELECTION_ID, 0, "pending")).toHaveCount(0);
  expect(await callHandle(page, "getPendingSelection", [])).toBeNull();
});

test("Escape removes a pending region", async ({ mount, page }) => {
  await mount(<PdfHarness annotationIds={[]} />);
  await ready(page);
  const root = annotatorRoot(page);
  await dragOverTokens(page, 0, 0, 1);
  await expect(pendingRegion(root, 0)).toHaveCount(1);

  await page.keyboard.press("Escape");

  await expect(pendingRegion(root, 0)).toHaveCount(0);
  expect(await callHandle(page, "getPendingSelection", [])).toBeNull();
});

test("readOnly + activeLabel: selection is reported, nothing is created", async ({
  mount,
  page,
}) => {
  await mount(
    <PdfHarness
      annotationIds={[]}
      props={{ readOnly: true, activeLabel: ACTIVE }}
    />
  );
  await ready(page);
  const root = annotatorRoot(page);

  await dragOverTokens(page, 0, 0, 1);

  await expect.poll(async () => (await textSelections(page)).length).toBe(1);
  expect((await textSelections(page))[0].rawText).toBe(TITLE_TEXT);
  expect(await createdDrafts(page)).toEqual([]);
  await expect(pendingRegion(root, 0)).toHaveCount(1);
});

test("pending selection survives scrolling its page out and back", async ({
  mount,
  page,
}) => {
  await mount(<PdfHarness annotationIds={[]} />);
  await ready(page);
  const root = annotatorRoot(page);
  await dragOverTokens(page, 0, 0, 1);
  const before = await callHandle(page, "getPendingSelection", []);
  expect(before?.rawText).toBe(TITLE_TEXT);

  await scrollToPage(page, FAR_PAGE);

  const range = await callHandle(page, "getVisiblePageRange", []);
  expect(range?.[0]).toBeGreaterThan(0);
  // Its page is kept mounted, region and all, while out of view.
  expect(await mountedPages(root)).toContain(0);
  await expect(pendingRegion(root, 0)).toHaveCount(1);

  await scrollToPage(page, 0);

  await expect(pendingRegion(root, 0)).toBeVisible();
  await expect(tokenRects(root, SELECTION_ID, 0, "pending")).toHaveCount(2);
  expect(await callHandle(page, "getPendingSelection", [])).toEqual(before);
});

test("shift-drag on page 0 then page 1 -> one draft whose json has keys 0 and 1", async ({
  mount,
  page,
}) => {
  await mount(<PdfHarness annotationIds={[]} />);
  await ready(page);
  const root = annotatorRoot(page);

  await dragOverTokens(page, 0, 0, 1, { shift: true });

  expect(await textSelections(page)).toEqual([]);
  await expect(dragRegions(root, 0)).toHaveCount(1);
  await expect(tokenRects(root, SELECTION_ID, 0, "drag")).toHaveCount(2);

  // The kept region keeps its page mounted while it is out of view.
  await scrollToPage(page, FAR_PAGE);
  expect(await mountedPages(root)).toContain(0);
  await expect(dragRegions(root, 0)).toHaveCount(1);

  await scrollToPage(page, 1);
  await dragOverTokens(page, 1, 1, 3);

  await expect.poll(async () => (await textSelections(page)).length).toBe(1);
  const [pending] = await textSelections(page);
  expect(Object.keys(pending.json)).toEqual(["0", "1"]);
  expect(pending.page).toBe(0);
  expect(pageJson(pending, 0).tokensJsons).toEqual(TITLE_TOKENS);
  expect(pageJson(pending, 1).tokensJsons).toEqual([
    { pageIndex: 1, tokenIndex: 1 },
    { pageIndex: 1, tokenIndex: 2 },
    { pageIndex: 1, tokenIndex: 3 },
  ]);
  expect(pending.rawText).toBe(
    `${TITLE_TEXT} ${pageJson(pending, 1).rawText}`
  );
  await expect(dragRegions(root, 0)).toHaveCount(0);
  await expect(pendingRegion(root, 0)).toHaveCount(1);
  await expect(pendingRegion(root, 1)).toHaveCount(1);
});

test("drag over an existing annotation still selects the text under it", async ({
  mount,
  page,
}) => {
  await mount(<PdfHarness annotationIds={["a-title"]} />);
  await ready(page);
  const root = annotatorRoot(page);
  await expect(annotationBox(root, "a-title", 0)).toHaveCount(1);
  const start = await tokenPoint(page, 0, 0, DRAG_START_FRACTION);
  // The press lands on the annotation's box, not on the page beneath it.
  expect(
    await page.evaluate(
      ({ x, y }) =>
        document
          .elementFromPoint(x, y)
          ?.closest('[data-rca-annotation="a-title"]') !== null,
      start
    )
  ).toBe(true);

  await dragOverTokens(page, 0, 0, 1);

  await expect.poll(async () => (await textSelections(page)).length).toBe(1);
  const [pending] = await textSelections(page);
  expect(pending.rawText).toBe(TITLE_TEXT);
  expect(pageJson(pending, 0).tokensJsons).toEqual(TITLE_TOKENS);
  // A drag is not a click on the annotation.
  expect(await harnessEvents(page, "onAnnotationClick")).toEqual([]);
});

test("drag on blank margin produces no onTextSelect", async ({
  mount,
  page,
}) => {
  await mount(<PdfHarness annotationIds={[]} />);
  await ready(page);
  const root = annotatorRoot(page);

  await drag(
    page,
    await pagePoint(page, 0, MARGIN_FROM),
    await pagePoint(page, 0, MARGIN_TO)
  );

  expect(await textSelections(page)).toEqual([]);
  await expect(pendingRegion(root, 0)).toHaveCount(0);
  await expect(dragRegions(root, 0)).toHaveCount(0);
});

test("click on a blank margin deselects a selected annotation and removes a pending region", async ({
  mount,
  page,
}) => {
  await mount(<PdfHarness annotationIds={["a-title"]} />);
  await ready(page);
  const root = annotatorRoot(page);
  // "Certain information": clear of a-title.
  await dragOverTokens(page, 0, 2, 3);
  await expect(pendingRegion(root, 0)).toHaveCount(1);
  await callHandle(page, "selectAnnotations", [["a-title"], { scroll: false }]);
  const title = annotationBox(root, "a-title", 0);
  await expect(title).toHaveAttribute("data-selected", "true");

  const point = await pagePoint(page, 0, MARGIN_POINT);
  await page.mouse.click(point.x, point.y);

  await expect(title).toHaveAttribute("data-selected", "false");
  await expect(pendingRegion(root, 0)).toHaveCount(0);
  expect(await userSelectionChanges(page)).toEqual([[[], { source: "user" }]]);
  expect(await callHandle(page, "getPendingSelection", [])).toBeNull();
  // The click selected no text.
  expect(await textSelections(page)).toHaveLength(1);
});

test("plain click on a-title leaves an existing selection of a-far unchanged and fires onAnnotationClick", async ({
  mount,
  page,
}) => {
  await mount(<PdfHarness annotationIds={["a-title", "a-far"]} />);
  await ready(page);
  const root = annotatorRoot(page);
  await dragOverTokens(page, 0, 2, 3);
  await expect(pendingRegion(root, 0)).toHaveCount(1);
  await callHandle(page, "selectAnnotations", [["a-far"], { scroll: false }]);
  const title = annotationBox(root, "a-title", 0);
  await expect(title).toHaveCount(1);

  await title.click();

  await expect
    .poll(async () =>
      (await harnessEvents(page, "onAnnotationClick")).map(
        ([, annotation]) => (annotation as Annotation).id
      )
    )
    .toEqual(["a-title"]);
  expect(await callHandle(page, "getSelectedAnnotationIds", [])).toEqual([
    "a-far",
  ]);
  expect(await userSelectionChanges(page)).toEqual([]);
  await expect(title).toHaveAttribute("data-selected", "false");
  // Nor does it end the pending selection.
  await expect(pendingRegion(root, 0)).toHaveCount(1);
});

test("usc fixture without pawls: dragging produces no onTextSelect and no error", async ({
  mount,
  page,
}) => {
  await mount(<PdfHarness fixture="usc" withPawls={false} />);
  await ready(page);
  const root = annotatorRoot(page);
  const canvas = await pageCanvas(root, 0).boundingBox();
  if (!canvas) throw new Error("page 0 is not mounted");

  await drag(
    page,
    { x: canvas.x + canvas.width / 4, y: canvas.y + canvas.height / 8 },
    { x: canvas.x + canvas.width / 2, y: canvas.y + canvas.height / 4 }
  );

  expect(await textSelections(page)).toEqual([]);
  expect(await callHandle(page, "getPendingSelection", [])).toBeNull();
  await expect(dragRegions(root, 0)).toHaveCount(0);
});

test("host adds the draft to annotations -> it renders as a normal annotation box", async ({
  mount,
  page,
}) => {
  await mount(
    <PdfHarness annotationIds={[]} addCreated props={{ activeLabel: ACTIVE }} />
  );
  await ready(page);
  const root = annotatorRoot(page);

  await dragOverTokens(page, 0, 0, 1);

  await expect.poll(async () => (await createdDrafts(page)).length).toBe(1);
  const [draft] = await createdDrafts(page);
  const created = annotationBox(root, "created-1", 0);
  await expect(created).toHaveCount(1);
  const zoom = await callHandle(page, "getZoom", []);
  expectRectClose(
    await boxRelativeToCanvas(root, "created-1", 0),
    scaledRect(pageJson(draft, 0).bounds, zoom)
  );
  await expect(tokenRects(root, "created-1", 0)).toHaveCount(2);
  await expect(pendingRegion(root, 0)).toHaveCount(0);
});

test("the same drag selects the same tokens at zoom 1 and 1.5, and its box scales", async ({
  mount,
  page,
}) => {
  await mount(<PdfHarness annotationIds={[]} props={{ defaultZoom: 1 }} />);
  await ready(page);
  const root = annotatorRoot(page);
  const selections: PendingSelection[] = [];

  for (const zoom of [1, 1.5]) {
    await callHandle(page, "clearPendingSelection", []);
    await callHandle(page, "setZoom", [zoom]);
    await expect.poll(() => callHandle(page, "getZoom", [])).toBe(zoom);
    await page.waitForTimeout(RENDER_SETTLE_MS);

    await dragOverTokens(page, 0, 0, 1);

    await expect
      .poll(async () => (await textSelections(page)).length)
      .toBe(selections.length + 1);
    const latest = (await textSelections(page))[selections.length];
    selections.push(latest);
    expectRectClose(
      await boxRelativeToCanvas(root, SELECTION_ID, 0, "pending"),
      scaledRect(pageJson(latest, 0).bounds, zoom)
    );
  }

  const [atOne, atOneAndAHalf] = selections;
  expect(atOneAndAHalf.rawText).toBe(TITLE_TEXT);
  expect(atOneAndAHalf.json).toEqual(atOne.json);
});
