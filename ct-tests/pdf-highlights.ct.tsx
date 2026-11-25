import { expect, test } from "@playwright/experimental-ct-react";
import type { Page } from "@playwright/test";

import { PdfHarness } from "./wrappers/PdfHarness";

import type { Highlight, PawlsPage } from "../src/core/index";
import { fetchFixture, serveFixtures } from "./helpers/fixtures";
import {
  boxInRootView,
  boxRelativeToCanvas,
  expectRectClose,
  highlightBox,
  mountedPages,
  settledScrollTop,
  tokenRects,
} from "./helpers/geometry";
import type { Rect } from "./helpers/geometry";
import {
  annotatorRoot,
  callHandle,
  harnessEvents,
  waitForDocumentLoad,
} from "./helpers/harness";

/** How far from the view's centre a centred box may be. */
const CENTRE_TOLERANCE_PX = 80;
/** Pixels the spanning box of a highlight's tokens extends beyond them. */
const TOKEN_BOX_PADDING = 3;
/** Longer than the viewport's shared render debounce. */
const RENDER_SETTLE_MS = 400;
/** A scroll position below the top, so a stray scroll to the top shows. */
const NUDGED_SCROLL_TOP = 30;

/** Two tokens of page 0 (`Certain information`), above any annotation. */
const NEAR: Highlight = {
  id: "h-near",
  target: { kind: "tokens", tokensByPage: { 0: [2, 3] } },
};
/** A box given by its bounds only, in green. */
const BOUNDED: Highlight = {
  id: "h-bounds",
  color: "#16a34a",
  target: {
    kind: "bounds",
    boundsByPage: { 0: { left: 100, top: 300, right: 300, bottom: 340 } },
  },
};
const SECOND_PAGE: Highlight = {
  id: "h-p1",
  target: { kind: "tokens", tokensByPage: { 1: [0, 1, 2] } },
};
/** On page 17, which is not mounted at load. */
const FAR: Highlight = {
  id: "h-far",
  color: "#dc2626",
  target: { kind: "tokens", tokensByPage: { 17: [0, 1, 2] } },
};
/** The token `“Agreement’”)` of page 0, clear of every fixture annotation. */
const CLICKABLE: Highlight = {
  id: "h-click",
  target: { kind: "tokens", tokensByPage: { 0: [47] } },
};

const ALL = [NEAR, BOUNDED, SECOND_PAGE, FAR];

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

/** The box around fixture tokens of a page, as the overlay derives it. */
async function tokenBox(
  page: Page,
  pageIndex: number,
  tokenIndices: number[],
  zoom: number
): Promise<Rect> {
  const pawls = await fetchFixture<PawlsPage[]>(page, "eton/pawls.json");
  const tokens = tokenIndices.map((i) => pawls[pageIndex].tokens[i]);
  const left = Math.min(...tokens.map((t) => t.x)) - TOKEN_BOX_PADDING;
  const top = Math.min(...tokens.map((t) => t.y)) - TOKEN_BOX_PADDING;
  const right =
    Math.max(...tokens.map((t) => t.x + t.width)) + TOKEN_BOX_PADDING;
  const bottom =
    Math.max(...tokens.map((t) => t.y + t.height)) + TOKEN_BOX_PADDING;
  return {
    left: left * zoom,
    top: top * zoom,
    width: (right - left) * zoom,
    height: (bottom - top) * zoom,
  };
}

/** Expects the highlight's box to be inside the root's view. */
async function expectInView(
  page: Page,
  id: string,
  pageIndex: number
): Promise<{ top: number; bottom: number; viewHeight: number }> {
  const view = await boxInRootView(
    annotatorRoot(page),
    id,
    pageIndex,
    "highlight"
  );
  expect(view.top).toBeGreaterThanOrEqual(0);
  expect(view.bottom).toBeLessThanOrEqual(view.viewHeight);
  return view;
}

/**
 * Expects the highlight's box to be inside the view and vertically centred
 * (so it must be one the page has room above and below).
 */
async function expectCentred(
  page: Page,
  id: string,
  pageIndex: number
): Promise<void> {
  const { top, bottom, viewHeight } = await expectInView(page, id, pageIndex);
  expect(Math.abs((top + bottom) / 2 - viewHeight / 2)).toBeLessThanOrEqual(
    CENTRE_TOLERANCE_PX
  );
}

/** Ids of the highlights with a box anywhere in the root, sorted. */
async function paintedIds(page: Page): Promise<string[]> {
  const ids = await annotatorRoot(page)
    .locator("[data-rca-highlight]")
    .evaluateAll((boxes) =>
      boxes.map((box) => box.getAttribute("data-rca-highlight") ?? "")
    );
  return [...new Set(ids)].sort();
}

test("all supplied highlights on mounted pages are painted", async ({
  mount,
  page,
}) => {
  await mount(<PdfHarness props={{ highlights: ALL, defaultZoom: 1 }} />);
  await waitForDocumentLoad(page);
  const root = annotatorRoot(page);
  await expect.poll(() => mountedPages(root)).toContain(1);
  expect(await mountedPages(root)).not.toContain(17);

  await expect.poll(() => paintedIds(page)).toEqual([
    "h-bounds",
    "h-near",
    "h-p1",
  ]);
  // None of them is the active one.
  await expect(root.locator("[data-active]")).toHaveCount(0);

  // Scrolling the far page in paints its highlight too.
  expect(await callHandle(page, "scrollToPage", [17])).toBe(true);
  await expect(highlightBox(root, "h-far", 17)).toHaveCount(1);
});

test("highlight boxes and token rects sit on their tokens and bounds, at two zooms (±1px)", async ({
  mount,
  page,
}) => {
  await mount(<PdfHarness props={{ highlights: ALL, defaultZoom: 1 }} />);
  await waitForDocumentLoad(page);
  const root = annotatorRoot(page);

  // Boxed from tokens, and one rect per token.
  await expect(highlightBox(root, "h-near", 0)).toHaveCount(1);
  expectRectClose(
    await boxRelativeToCanvas(root, "h-near", 0, "highlight"),
    await tokenBox(page, 0, [2, 3], 1)
  );
  await expect(tokenRects(root, "h-near", 0, "highlight")).toHaveCount(2);
  // Boxed from its bounds, and no token rects at all.
  expectRectClose(
    await boxRelativeToCanvas(root, "h-bounds", 0, "highlight"),
    { left: 100, top: 300, width: 200, height: 40 }
  );
  await expect(root.locator('[data-rca-highlight-token="h-bounds"]')).toHaveCount(
    0
  );

  await callHandle(page, "setZoom", [1.5]);
  await expect
    .poll(async () =>
      (await boxRelativeToCanvas(root, "h-near", 0, "highlight")).width
    )
    .toBeCloseTo((await tokenBox(page, 0, [2, 3], 1.5)).width, 0);
  expectRectClose(
    await boxRelativeToCanvas(root, "h-near", 0, "highlight"),
    await tokenBox(page, 0, [2, 3], 1.5)
  );
  expectRectClose(
    await boxRelativeToCanvas(root, "h-bounds", 0, "highlight"),
    { left: 150, top: 450, width: 300, height: 60 }
  );
});

test("a highlight's label shows according to labelDisplay", async ({
  mount,
  page,
}) => {
  const labelled: Highlight = { ...NEAR, label: "Search hit 1 of 2" };
  const component = await mount(
    <PdfHarness props={{ highlights: [labelled], labelDisplay: "always" }} />
  );
  await waitForDocumentLoad(page);
  const root = annotatorRoot(page);
  const chip = highlightBox(root, "h-near", 0).locator("[data-rca-label-chip]");

  await expect(chip).toHaveText("Search hit 1 of 2");

  await component.update(
    <PdfHarness props={{ highlights: [labelled], labelDisplay: "hide" }} />
  );
  await expect(highlightBox(root, "h-near", 0)).toHaveCount(1);
  await expect(chip).toHaveCount(0);
});

test("activeHighlightId prop change scrolls to it and marks it data-active", async ({
  mount,
  page,
}) => {
  const component = await mount(
    <PdfHarness mode="controlled" props={{ highlights: ALL }} />
  );
  await waitForDocumentLoad(page);
  const root = annotatorRoot(page);
  await expect(highlightBox(root, "h-near", 0)).toHaveCount(1);

  await component.update(
    <PdfHarness
      mode="controlled"
      props={{ highlights: ALL, activeHighlightId: "h-far" }}
    />
  );

  await expect(highlightBox(root, "h-far", 17)).toHaveAttribute(
    "data-active",
    ""
  );
  await settledScrollTop(root);
  await expectCentred(page, "h-far", 17);
  await expect(root.locator("[data-active]")).toHaveCount(1);

  // And back: the page it leaves is mounted again, with nothing active there.
  await component.update(
    <PdfHarness
      mode="controlled"
      props={{ highlights: ALL, activeHighlightId: "h-near" }}
    />
  );
  await expect(highlightBox(root, "h-near", 0)).toHaveAttribute(
    "data-active",
    ""
  );
  await settledScrollTop(root);
  // Near the top of the first page, which cannot be scrolled to the centre.
  await expectInView(page, "h-near", 0);
  await expect(root.locator("[data-active]")).toHaveCount(1);
});

test("an active highlight present at load (deep link) is scrolled to once the pages are in", async ({
  mount,
  page,
}) => {
  await mount(
    <PdfHarness props={{ highlights: ALL, defaultActiveHighlightId: "h-far" }} />
  );
  await waitForDocumentLoad(page);
  const root = annotatorRoot(page);

  await expect(highlightBox(root, "h-far", 17)).toHaveAttribute(
    "data-active",
    ""
  );
  await settledScrollTop(root);
  await expectCentred(page, "h-far", 17);
});

test("handle.scrollToHighlight(id, {activate:true}) fires onActiveHighlightChange(id) and resolves true", async ({
  mount,
  page,
}) => {
  await mount(<PdfHarness props={{ highlights: ALL }} />);
  await waitForDocumentLoad(page);
  const root = annotatorRoot(page);
  await expect.poll(() => mountedPages(root)).toContain(0);

  expect(
    await callHandle(page, "scrollToHighlight", ["h-far", { activate: true }])
  ).toBe(true);

  // Resolved once the scroll landed, so the box is already in view.
  await expectCentred(page, "h-far", 17);
  expect(await harnessEvents(page, "onActiveHighlightChange")).toEqual([
    ["onActiveHighlightChange", "h-far"],
  ]);
  await expect(highlightBox(root, "h-far", 17)).toHaveAttribute(
    "data-active",
    ""
  );
  // The activation raised no second scroll.
  const landed = await root.evaluate((el) => el.scrollTop);
  await page.waitForTimeout(RENDER_SETTLE_MS);
  expect(await settledScrollTop(root)).toBe(landed);
});

test("scrollToHighlight without activate scrolls and leaves the active highlight alone", async ({
  mount,
  page,
}) => {
  await mount(<PdfHarness props={{ highlights: ALL }} />);
  await waitForDocumentLoad(page);
  const root = annotatorRoot(page);
  await expect.poll(() => mountedPages(root)).toContain(0);

  expect(
    await callHandle(page, "scrollToHighlight", [
      "h-far",
      { behavior: "instant" },
    ])
  ).toBe(true);

  await expectCentred(page, "h-far", 17);
  expect(await harnessEvents(page, "onActiveHighlightChange")).toEqual([]);
  await expect(highlightBox(root, "h-far", 17)).not.toHaveAttribute(
    "data-active"
  );
});

test("scrollToHighlight resolves false for an id that is unknown", async ({
  mount,
  page,
}) => {
  await mount(<PdfHarness props={{ highlights: ALL }} />);
  await waitForDocumentLoad(page);
  const root = annotatorRoot(page);
  await expect.poll(() => mountedPages(root)).toContain(0);

  expect(await callHandle(page, "scrollToHighlight", ["nope"])).toBe(false);
  expect(
    await callHandle(page, "scrollToHighlight", ["nope", { activate: true }])
  ).toBe(false);
  expect(await harnessEvents(page, "onActiveHighlightChange")).toEqual([]);
});

test("a highlight whose tokens are not on the page cannot be scrolled to, and one past the last page neither", async ({
  mount,
  page,
}) => {
  const hollow: Highlight = {
    id: "h-hollow",
    target: { kind: "tokens", tokensByPage: { 0: [100000] } },
  };
  const beyond: Highlight = {
    id: "h-beyond",
    target: { kind: "tokens", tokensByPage: { 500: [0] } },
  };
  await mount(<PdfHarness props={{ highlights: [hollow, beyond, NEAR] }} />);
  await waitForDocumentLoad(page);
  const root = annotatorRoot(page);
  await expect(highlightBox(root, "h-near", 0)).toHaveCount(1);

  expect(await callHandle(page, "scrollToHighlight", ["h-hollow"])).toBe(false);
  expect(await callHandle(page, "scrollToHighlight", ["h-beyond"])).toBe(false);
  expect(await paintedIds(page)).toEqual(["h-near"]);
});

test("a span highlight draws nothing and cannot be scrolled to", async ({
  mount,
  page,
}) => {
  const span: Highlight = {
    id: "h-span",
    target: { kind: "span", start: 0, end: 12 },
  };
  await mount(<PdfHarness props={{ highlights: [span, NEAR] }} />);
  await waitForDocumentLoad(page);
  const root = annotatorRoot(page);

  await expect(highlightBox(root, "h-near", 0)).toHaveCount(1);
  expect(await paintedIds(page)).toEqual(["h-near"]);
  expect(await callHandle(page, "scrollToHighlight", ["h-span"])).toBe(false);
  expect(
    await callHandle(page, "scrollToHighlight", ["h-span", { activate: true }])
  ).toBe(false);
  expect(await harnessEvents(page, "onActiveHighlightChange")).toEqual([]);

  // The development warning is expected, once, in a development build (the
  // component tests currently run a production bundle, which has none); any
  // other console problem still fails the test.
  const spanWarnings = consoleProblems.filter((m) => m.includes('"span"'));
  expect(spanWarnings.length).toBeLessThanOrEqual(1);
  for (const warning of spanWarnings) {
    consoleProblems.splice(consoleProblems.indexOf(warning), 1);
  }
});

test("getText is the token text and findText('Exhibit') starts with page 0 token 0", async ({
  mount,
  page,
}) => {
  await mount(<PdfHarness />);
  await waitForDocumentLoad(page);

  const text = await callHandle(page, "getText", []);
  expect(text.startsWith("Exhibit 10.1 Certain information")).toBe(true);

  const found = await callHandle(page, "findText", ["exhibit"]);
  expect(found.length).toBeGreaterThan(1);
  expect(found[0]).toEqual({
    id: "find-0",
    target: { kind: "tokens", tokensByPage: { 0: [0] } },
  });
  expect(await callHandle(page, "findText", ["exhibit", { caseSensitive: true }]))
    .not.toEqual(found);
  expect(await callHandle(page, "findText", ["   "])).toEqual([]);
  expect(await callHandle(page, "findText", ["no such phrase anywhere"])).toEqual(
    []
  );
});

test("round trip: handle.findText('Agreement') -> pass as highlights -> scrollToHighlight(last.id) lands on a later page", async ({
  mount,
  page,
}) => {
  const component = await mount(<PdfHarness />);
  await waitForDocumentLoad(page);
  const root = annotatorRoot(page);
  await expect.poll(() => mountedPages(root)).toContain(0);

  const found = await callHandle(page, "findText", ["Agreement"]);
  expect(found.length).toBeGreaterThan(10);
  const last = found[found.length - 1];
  const lastTokens = (
    last.target as { tokensByPage: Record<number, number[]> }
  ).tokensByPage;
  const lastPage = Number(Object.keys(lastTokens)[0]);
  expect(lastPage).toBeGreaterThan(0);

  await component.update(<PdfHarness props={{ highlights: found }} />);
  // Every hit on a mounted page is painted.
  await expect(highlightBox(root, "find-0", 0)).toHaveCount(1);

  expect(
    await callHandle(page, "scrollToHighlight", [last.id, { activate: true }])
  ).toBe(true);

  await expect(highlightBox(root, last.id, lastPage)).toHaveAttribute(
    "data-active",
    ""
  );
  await expectCentred(page, last.id, lastPage);
});

test("highlights and annotations render together; clicking a highlight does not change annotation selection", async ({
  mount,
  page,
}) => {
  await mount(
    <PdfHarness
      annotationIds={["a-title", "a-link"]}
      props={{
        highlights: [CLICKABLE, NEAR],
        defaultSelectedAnnotationIds: ["a-title"],
        defaultZoom: 1,
      }}
    />
  );
  await waitForDocumentLoad(page);
  const root = annotatorRoot(page);

  const box = highlightBox(root, "h-click", 0);
  await expect(box).toHaveCount(1);
  await expect(root.locator('[data-rca-annotation="a-title"]')).toHaveCount(1);
  await expect(root.locator('[data-rca-annotation="a-link"]')).toHaveCount(1);
  await expect(root.locator('[data-rca-annotation="a-title"]')).toHaveAttribute(
    "data-selected",
    "true"
  );
  await root.evaluate((el, top) => {
    el.scrollTop = top;
  }, NUDGED_SCROLL_TOP);

  await box.click();

  await expect
    .poll(() => harnessEvents(page, "onActiveHighlightChange"))
    .toEqual([["onActiveHighlightChange", "h-click"]]);
  // Uncontrolled: it is the active one now; the selection did not move.
  await expect(box).toHaveAttribute("data-active", "");
  expect(await harnessEvents(page, "onSelectionChange")).toEqual([]);
  expect(await callHandle(page, "getSelectedAnnotationIds", [])).toEqual([
    "a-title",
  ]);
  await expect(root.locator('[data-rca-annotation="a-title"]')).toHaveAttribute(
    "data-selected",
    "true"
  );
  // A click does not scroll.
  await page.waitForTimeout(RENDER_SETTLE_MS);
  expect(await settledScrollTop(root)).toBe(NUDGED_SCROLL_TOP);
});

test("a click on a controlled highlight asks the host and leaves it to apply the change", async ({
  mount,
  page,
}) => {
  const component = await mount(
    <PdfHarness mode="controlled" props={{ highlights: [CLICKABLE] }} />
  );
  await waitForDocumentLoad(page);
  const root = annotatorRoot(page);
  const box = highlightBox(root, "h-click", 0);
  await expect(box).toHaveCount(1);

  await box.click();

  await expect
    .poll(() => harnessEvents(page, "onActiveHighlightChange"))
    .toEqual([["onActiveHighlightChange", "h-click"]]);
  await page.waitForTimeout(RENDER_SETTLE_MS);
  await expect(box).not.toHaveAttribute("data-active");

  await component.update(
    <PdfHarness
      mode="controlled"
      props={{ highlights: [CLICKABLE], activeHighlightId: "h-click" }}
    />
  );
  await expect(box).toHaveAttribute("data-active", "");
});

test("a press on a highlight that is dragged away before release is not a click", async ({
  mount,
  page,
}) => {
  await mount(<PdfHarness props={{ highlights: [CLICKABLE] }} />);
  await waitForDocumentLoad(page);
  const root = annotatorRoot(page);
  const box = highlightBox(root, "h-click", 0);
  await expect(box).toHaveCount(1);

  const rect = await box.boundingBox();
  if (!rect) throw new Error("highlight has no box");
  await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
  await page.mouse.down();
  await page.mouse.move(rect.x + rect.width / 2 + 40, rect.y + 60, {
    steps: 5,
  });
  await page.mouse.up();

  await page.waitForTimeout(RENDER_SETTLE_MS);
  expect(await harnessEvents(page, "onActiveHighlightChange")).toEqual([]);
});
