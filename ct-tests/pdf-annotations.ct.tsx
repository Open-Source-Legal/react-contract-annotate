import { expect, test } from "@playwright/experimental-ct-react";
import type { Locator, Page } from "@playwright/test";

import { PdfHarness } from "./wrappers/PdfHarness";

import type { Annotation, PawlsPage } from "../src/core/index";
import { fetchFixture, serveFixtures } from "./helpers/fixtures";
import {
  annotationBox,
  boxInRootView,
  boxRelativeToCanvas,
  mountedPages,
  settledScrollTop,
  tokenRects,
  tokenRectsRelativeToCanvas,
} from "./helpers/geometry";
import {
  annotatorRoot,
  callHandle,
  harnessEvents,
  waitForDocumentLoad,
} from "./helpers/harness";

type PageJson = {
  bounds: { top: number; left: number; right: number; bottom: number };
  tokensJsons: { pageIndex: number; tokenIndex: number }[];
};

/** A fixture annotation's v1 JSON of one page. */
async function fixturePage(
  page: Page,
  id: string,
  pageIndex: number
): Promise<PageJson> {
  const annotations = await fetchFixture<Annotation[]>(
    page,
    "eton/annotations.json"
  );
  const annotation = annotations.find((a) => a.id === id);
  if (!annotation) throw new Error(`no fixture annotation ${id}`);
  return (annotation.json as Record<number, PageJson>)[pageIndex];
}

/** Tolerance (px) of measured geometry. */
const GEOMETRY_TOLERANCE_PX = 1;
/** How far from the view's centre a centred box may be. */
const CENTRE_TOLERANCE_PX = 80;
/** Pixels each token rect extends beyond its token on every side. */
const TOKEN_EXPANSION_PX = 1;
/** Longer than the viewport's shared render debounce. */
const RENDER_SETTLE_MS = 400;
/** A scroll position below the top that keeps page 0's top annotations in view. */
const NUDGED_SCROLL_TOP = 30;
/** Distinct positions an instant annotation scroll passes: the page, then the box. */
const INSTANT_SCROLL_POSITIONS = 2;
/** At zoom 2, a horizontal scroll that keeps a-title (x 1008..1088) in view. */
const VISIBLE_SCROLL_LEFT = 250;

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

function expectRectClose(
  actual: { left: number; top: number; width: number; height: number },
  expected: { left: number; top: number; width: number; height: number }
): void {
  for (const key of ["left", "top", "width", "height"] as const) {
    expect(Math.abs(actual[key] - expected[key])).toBeLessThanOrEqual(
      GEOMETRY_TOLERANCE_PX
    );
  }
}

/** `bounds` scaled by `zoom`, as a rect. */
function scaledRect(
  bounds: { top: number; left: number; right: number; bottom: number },
  zoom: number
) {
  return {
    left: bounds.left * zoom,
    top: bounds.top * zoom,
    width: (bounds.right - bounds.left) * zoom,
    height: (bounds.bottom - bounds.top) * zoom,
  };
}

/** Replaces `window.open` with a recorder; read it with `openedUrls`. */
async function recordWindowOpen(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __opened: unknown[][] };
    w.__opened = [];
    window.open = (...args: unknown[]) => {
      w.__opened.push(args);
      return null;
    };
  });
}

function openedUrls(page: Page): Promise<unknown[][]> {
  return page.evaluate(
    () => (window as unknown as { __opened: unknown[][] }).__opened
  );
}

/** Records the root's `scrollTop` on every scroll event; read it with `recordedScrollTops`. */
async function recordScrollTops(root: Locator): Promise<void> {
  await root.evaluate((el) => {
    const w = window as unknown as { __scrollTops: number[] };
    w.__scrollTops = [];
    el.addEventListener("scroll", () => w.__scrollTops.push(el.scrollTop));
  });
}

function recordedScrollTops(page: Page): Promise<number[]> {
  return page.evaluate(
    () => (window as unknown as { __scrollTops: number[] }).__scrollTops
  );
}

/** Ids of the annotations with a box anywhere in the root. */
async function drawnIds(root: Locator): Promise<string[]> {
  const ids = await root
    .locator("[data-rca-annotation]")
    .evaluateAll((boxes) =>
      boxes.map((box) => box.getAttribute("data-rca-annotation") ?? "")
    );
  return [...new Set(ids)].sort();
}

test("a-title box equals json bounds x zoom, at zoom 1 and 1.5 (±1px)", async ({
  mount,
  page,
}) => {
  await mount(
    <PdfHarness annotationIds={["a-title"]} props={{ defaultZoom: 1 }} />
  );
  await waitForDocumentLoad(page);
  const root = annotatorRoot(page);
  const { bounds } = await fixturePage(page, "a-title", 0);

  await expect(annotationBox(root, "a-title", 0)).toHaveCount(1);
  expectRectClose(
    await boxRelativeToCanvas(root, "a-title", 0),
    scaledRect(bounds, 1)
  );

  await callHandle(page, "setZoom", [1.5]);

  await expect
    .poll(async () => (await boxRelativeToCanvas(root, "a-title", 0)).width)
    .toBeCloseTo((bounds.right - bounds.left) * 1.5, 0);
  expectRectClose(
    await boxRelativeToCanvas(root, "a-title", 0),
    scaledRect(bounds, 1.5)
  );
});

test("token rects of a-title cover tokens 0 and 1 (±1px)", async ({
  mount,
  page,
}) => {
  await mount(
    <PdfHarness annotationIds={["a-title"]} props={{ defaultZoom: 1 }} />
  );
  await waitForDocumentLoad(page);
  const root = annotatorRoot(page);
  await expect(tokenRects(root, "a-title", 0)).toHaveCount(2);

  const rects = await tokenRectsRelativeToCanvas(root, "a-title", 0);
  const pawls = await fetchFixture<PawlsPage[]>(page, "eton/pawls.json");
  const tokens = [pawls[0].tokens[0], pawls[0].tokens[1]];
  rects.forEach((rect, i) => {
    const token = tokens[i];
    expectRectClose(rect, {
      left: token.x - TOKEN_EXPANSION_PX,
      top: token.y - TOKEN_EXPANSION_PX,
      width: token.width + 2 * TOKEN_EXPANSION_PX,
      height: token.height + 2 * TOKEN_EXPANSION_PX,
    });
  });
});

test("a-compact renders 16 token rects on page 2", async ({ mount, page }) => {
  await mount(<PdfHarness annotationIds={["a-compact"]} />);
  await waitForDocumentLoad(page);
  const root = annotatorRoot(page);

  expect(await callHandle(page, "scrollToPage", [2])).toBe(true);

  await expect(annotationBox(root, "a-compact", 2)).toHaveCount(1);
  await expect(tokenRects(root, "a-compact", 2)).toHaveCount(16);
});

test("scrollToAnnotation('a-far') resolves true and the box is inside the viewport, vertically centred ±80px", async ({
  mount,
  page,
}) => {
  await mount(<PdfHarness />);
  await waitForDocumentLoad(page);
  const root = annotatorRoot(page);
  await expect.poll(() => mountedPages(root)).toContain(0);

  expect(await callHandle(page, "scrollToAnnotation", ["a-far"])).toBe(true);

  await settledScrollTop(root);
  const { top, bottom, viewHeight } = await boxInRootView(root, "a-far", 17);
  expect(top).toBeGreaterThanOrEqual(0);
  expect(bottom).toBeLessThanOrEqual(viewHeight);
  expect(
    Math.abs((top + bottom) / 2 - viewHeight / 2)
  ).toBeLessThanOrEqual(CENTRE_TOLERANCE_PX);
});

for (const behavior of ["smooth", "instant"] as const) {
  test(`scrollToAnnotation('a-far', { behavior: '${behavior}' }) resolves once the box has landed, centred in view`, async ({
    mount,
    page,
  }) => {
    await mount(<PdfHarness />);
    await waitForDocumentLoad(page);
    const root = annotatorRoot(page);
    await expect.poll(() => mountedPages(root)).toContain(0);
    await recordScrollTops(root);

    expect(
      await callHandle(page, "scrollToAnnotation", ["a-far", { behavior }])
    ).toBe(true);

    // Measured at once: the promise means the scroll has landed.
    const landedTop = await root.evaluate((el) => el.scrollTop);
    const { top, bottom, viewHeight } = await boxInRootView(root, "a-far", 17);
    expect(top).toBeGreaterThanOrEqual(0);
    expect(bottom).toBeLessThanOrEqual(viewHeight);
    expect(
      Math.abs((top + bottom) / 2 - viewHeight / 2)
    ).toBeLessThanOrEqual(CENTRE_TOLERANCE_PX);
    expect(
      Math.abs((await settledScrollTop(root)) - landedTop)
    ).toBeLessThanOrEqual(GEOMETRY_TOLERANCE_PX);

    const positions = new Set(await recordedScrollTops(page)).size;
    if (behavior === "smooth") {
      expect(positions).toBeGreaterThan(INSTANT_SCROLL_POSITIONS);
    } else {
      expect(positions).toBeLessThanOrEqual(INSTANT_SCROLL_POSITIONS);
    }
  });
}

test("centring leaves scrollLeft alone for a horizontally visible box, and otherwise moves it the least", async ({
  mount,
  page,
}) => {
  await mount(
    <PdfHarness annotationIds={["a-title"]} props={{ defaultZoom: 2 }} />
  );
  await waitForDocumentLoad(page);
  const root = annotatorRoot(page);
  await expect(annotationBox(root, "a-title", 0)).toHaveCount(1);
  expect(await root.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(
    true
  );

  await root.evaluate((el, left) => {
    el.scrollLeft = left;
  }, VISIBLE_SCROLL_LEFT);
  const visible = await boxInRootView(root, "a-title", 0);
  expect(visible.left).toBeGreaterThanOrEqual(0);
  expect(visible.right).toBeLessThanOrEqual(visible.viewWidth);

  expect(
    await callHandle(page, "scrollToAnnotation", [
      "a-title",
      { behavior: "instant" },
    ])
  ).toBe(true);
  expect(await root.evaluate((el) => el.scrollLeft)).toBe(VISIBLE_SCROLL_LEFT);

  // Off to the right: scrolled just far enough to show its right edge.
  await root.evaluate((el) => {
    el.scrollLeft = 0;
  });
  const hidden = await boxInRootView(root, "a-title", 0);
  expect(hidden.right).toBeGreaterThan(hidden.viewWidth);

  expect(
    await callHandle(page, "scrollToAnnotation", [
      "a-title",
      { behavior: "instant" },
    ])
  ).toBe(true);
  const shown = await boxInRootView(root, "a-title", 0);
  expect(Math.abs(shown.right - shown.viewWidth)).toBeLessThanOrEqual(
    GEOMETRY_TOLERANCE_PX
  );
});

test("scrollToAnnotation('nope') resolves false; scrollToAnnotation('a-bad-page') resolves false", async ({
  mount,
  page,
}) => {
  await mount(<PdfHarness />);
  await waitForDocumentLoad(page);
  const root = annotatorRoot(page);
  await expect.poll(() => mountedPages(root)).toContain(0);

  expect(await callHandle(page, "scrollToAnnotation", ["nope"])).toBe(false);
  expect(await callHandle(page, "scrollToAnnotation", ["a-bad-page"])).toBe(
    false
  );
  expect(
    await callHandle(page, "scrollToAnnotation", ["a-bad-page", { select: true }])
  ).toBe(false);
  expect(await callHandle(page, "getSelectedAnnotationIds", [])).toEqual([]);
});

test("a-multi: selecting it keeps pages 3 and 4 mounted and draws a box on each", async ({
  mount,
  page,
}) => {
  await mount(<PdfHarness annotationIds={["a-multi"]} />);
  await waitForDocumentLoad(page);
  const root = annotatorRoot(page);
  await expect.poll(() => mountedPages(root)).toContain(0);
  expect(await mountedPages(root)).not.toContain(4);

  await callHandle(page, "selectAnnotations", [["a-multi"], { scroll: false }]);

  await expect.poll(() => mountedPages(root)).toEqual(
    expect.arrayContaining([3, 4])
  );
  await expect(annotationBox(root, "a-multi", 3)).toHaveAttribute(
    "data-selected",
    "true"
  );
  await expect(annotationBox(root, "a-multi", 4)).toHaveAttribute(
    "data-selected",
    "true"
  );
  const { bounds } = await fixturePage(page, "a-multi", 4);
  const zoom = await callHandle(page, "getZoom", []);
  expectRectClose(
    await boxRelativeToCanvas(root, "a-multi", 4),
    scaledRect(bounds, zoom)
  );
});

test("prop-driven selection of a-far scrolls to it; scrollOnSelect=false does not", async ({
  mount,
  page,
}) => {
  const component = await mount(<PdfHarness mode="controlled" />);
  await waitForDocumentLoad(page);
  const root = annotatorRoot(page);
  await expect.poll(() => mountedPages(root)).toContain(0);

  await component.update(
    <PdfHarness mode="controlled" props={{ selectedAnnotationIds: ["a-far"] }} />
  );

  await expect(annotationBox(root, "a-far", 17)).toHaveCount(1);
  await settledScrollTop(root);
  const { top, bottom, viewHeight } = await boxInRootView(root, "a-far", 17);
  expect(top).toBeGreaterThanOrEqual(0);
  expect(bottom).toBeLessThanOrEqual(viewHeight);

  await root.evaluate((el) => {
    el.scrollTop = 0;
  });
  await component.update(
    <PdfHarness
      mode="controlled"
      props={{ selectedAnnotationIds: ["a-multi"], scrollOnSelect: false }}
    />
  );

  await expect(annotationBox(root, "a-multi", 3)).toHaveAttribute(
    "data-selected",
    "true"
  );
  await page.waitForTimeout(RENDER_SETTLE_MS);
  expect(await settledScrollTop(root)).toBe(0);
});

test("a selection present at load (deep link) scrolls to a-far once the pages are in", async ({
  mount,
  page,
}) => {
  await mount(
    <PdfHarness props={{ defaultSelectedAnnotationIds: ["a-far"] }} />
  );
  await waitForDocumentLoad(page);
  const root = annotatorRoot(page);

  await expect(annotationBox(root, "a-far", 17)).toHaveCount(1);
  await settledScrollTop(root);
  const { top, bottom, viewHeight } = await boxInRootView(root, "a-far", 17);
  expect(top).toBeGreaterThanOrEqual(0);
  expect(bottom).toBeLessThanOrEqual(viewHeight);
});

test("shift-click toggles selection (uncontrolled) and fires onSelectionChange(ids, {source:'user'}) without scrolling", async ({
  mount,
  page,
}) => {
  await mount(<PdfHarness annotationIds={["a-title"]} />);
  await waitForDocumentLoad(page);
  const root = annotatorRoot(page);
  const box = annotationBox(root, "a-title", 0);
  await expect(box).toHaveCount(1);
  await root.evaluate((el, top) => {
    el.scrollTop = top;
  }, NUDGED_SCROLL_TOP);

  await box.click({ modifiers: ["Shift"] });

  await expect(box).toHaveAttribute("data-selected", "true");
  expect(await harnessEvents(page, "onSelectionChange")).toEqual([
    ["onSelectionChange", ["a-title"], { source: "user" }],
  ]);

  await box.click({ modifiers: ["Shift"] });

  await expect(box).toHaveAttribute("data-selected", "false");
  expect((await harnessEvents(page, "onSelectionChange")).at(-1)).toEqual([
    "onSelectionChange",
    [],
    { source: "user" },
  ]);
  await page.waitForTimeout(RENDER_SETTLE_MS);
  expect(await settledScrollTop(root)).toBe(NUDGED_SCROLL_TOP);
});

test("controlled selection: shift-click fires the callback and data-selected stays false until the prop changes", async ({
  mount,
  page,
}) => {
  const component = await mount(
    <PdfHarness mode="controlled" annotationIds={["a-title"]} />
  );
  await waitForDocumentLoad(page);
  const root = annotatorRoot(page);
  const box = annotationBox(root, "a-title", 0);
  await expect(box).toHaveCount(1);

  await box.click({ modifiers: ["Shift"] });

  await expect
    .poll(() => harnessEvents(page, "onSelectionChange"))
    .toEqual([["onSelectionChange", ["a-title"], { source: "user" }]]);
  await page.waitForTimeout(RENDER_SETTLE_MS);
  await expect(box).toHaveAttribute("data-selected", "false");

  await component.update(
    <PdfHarness
      mode="controlled"
      annotationIds={["a-title"]}
      props={{ selectedAnnotationIds: ["a-title"] }}
    />
  );

  await expect(box).toHaveAttribute("data-selected", "true");
});

test("plain click on a-title fires onAnnotationClick and does not select", async ({
  mount,
  page,
}) => {
  await mount(<PdfHarness annotationIds={["a-title"]} />);
  await waitForDocumentLoad(page);
  const root = annotatorRoot(page);
  const box = annotationBox(root, "a-title", 0);
  await expect(box).toHaveCount(1);

  await box.click();

  await expect
    .poll(async () =>
      (await harnessEvents(page, "onAnnotationClick")).map(
        ([, annotation]) => (annotation as Annotation).id
      )
    )
    .toEqual(["a-title"]);
  await expect(box).toHaveAttribute("data-selected", "false");
  expect(await harnessEvents(page, "onSelectionChange")).toEqual([]);
});

test("showStructural=false hides a-structural; true shows it; visibleLabelIds=['l-clause'] hides a-title", async ({
  mount,
  page,
}) => {
  const ids = ["a-structural", "a-title", "a-compact"];
  const component = await mount(
    <PdfHarness annotationIds={ids} props={{ showStructural: true }} />
  );
  await waitForDocumentLoad(page);
  const root = annotatorRoot(page);
  await expect(annotationBox(root, "a-structural", 1)).toHaveCount(1);
  await expect(annotationBox(root, "a-title", 0)).toHaveCount(1);

  await component.update(
    <PdfHarness annotationIds={ids} props={{ showStructural: false }} />
  );
  await expect(annotationBox(root, "a-structural", 1)).toHaveCount(0);
  await expect(annotationBox(root, "a-title", 0)).toHaveCount(1);

  await component.update(
    <PdfHarness annotationIds={ids} props={{ showStructural: true }} />
  );
  await expect(annotationBox(root, "a-structural", 1)).toHaveCount(1);

  await component.update(
    <PdfHarness
      annotationIds={ids}
      props={{ showStructural: true, visibleLabelIds: ["l-clause"] }}
    />
  );
  await expect(annotationBox(root, "a-title", 0)).toHaveCount(0);
  await expect(annotationBox(root, "a-compact", 2)).toHaveCount(1);
});

test("showSelectedOnly shows only the selected annotation", async ({
  mount,
  page,
}) => {
  await mount(
    <PdfHarness
      annotationIds={["a-title", "a-link", "a-compact"]}
      props={{
        showSelectedOnly: true,
        defaultSelectedAnnotationIds: ["a-link"],
      }}
    />
  );
  await waitForDocumentLoad(page);
  const root = annotatorRoot(page);
  await expect(annotationBox(root, "a-link", 0)).toHaveCount(1);
  // Page 2 (a-compact) is mounted and rendered too.
  await expect.poll(() => mountedPages(root)).toContain(2);
  await page.waitForTimeout(RENDER_SETTLE_MS);

  expect(await drawnIds(root)).toEqual(["a-link"]);
});

test("selectedRelationIds=['r-1'] forces both endpoints visible with SOURCE/TARGET badges", async ({
  mount,
  page,
}) => {
  const ids = ["a-title", "a-far"];
  const hideExhibits = { visibleLabelIds: ["l-clause"] };
  const component = await mount(
    <PdfHarness
      annotationIds={ids}
      props={{ ...hideExhibits, selectedRelationIds: ["r-1"] }}
    />
  );
  await waitForDocumentLoad(page);
  const root = annotatorRoot(page);

  await expect(
    annotationBox(root, "a-title", 0).locator("[data-rca-relation-role]")
  ).toHaveAttribute("data-rca-relation-role", "SOURCE");

  expect(await callHandle(page, "scrollToPage", [17])).toBe(true);
  await expect(
    annotationBox(root, "a-far", 17).locator("[data-rca-relation-role]")
  ).toHaveAttribute("data-rca-relation-role", "TARGET");

  await component.update(<PdfHarness annotationIds={ids} props={hideExhibits} />);
  await expect(annotationBox(root, "a-far", 17)).toHaveCount(0);
});

test("plain click on a-link calls onOpenLink('https://example.com/terms', annotation); ctrl-click selects instead", async ({
  mount,
  page,
}) => {
  await mount(<PdfHarness annotationIds={["a-link"]} />);
  await waitForDocumentLoad(page);
  await recordWindowOpen(page);
  const root = annotatorRoot(page);
  const box = annotationBox(root, "a-link", 0);
  await expect(box).toHaveCount(1);

  await box.click();

  const opened = await harnessEvents(page, "onOpenLink");
  expect(opened).toHaveLength(1);
  const [, url, source] = opened[0];
  expect(url).toBe("https://example.com/terms");
  expect((source as Annotation).id).toBe("a-link");
  expect(await harnessEvents(page, "onSelectionChange")).toEqual([]);

  await box.click({ modifiers: ["ControlOrMeta"] });

  await expect(box).toHaveAttribute("data-selected", "true");
  expect(await harnessEvents(page, "onSelectionChange")).toEqual([
    ["onSelectionChange", ["a-link"], { source: "user" }],
  ]);
  expect(await harnessEvents(page, "onOpenLink")).toHaveLength(1);
  expect(await openedUrls(page)).toEqual([]);
});

test("without onOpenLink a javascript: linkUrl is ignored", async ({
  mount,
  page,
}) => {
  await mount(
    <PdfHarness
      annotationIds={["a-link"]}
      linkUrls={{ "a-link": "javascript:alert(1)" }}
      omitCallbacks={["onOpenLink"]}
    />
  );
  await waitForDocumentLoad(page);
  await recordWindowOpen(page);
  const root = annotatorRoot(page);
  const box = annotationBox(root, "a-link", 0);
  await expect(box).toHaveCount(1);
  const url = page.url();

  await box.click();

  // The click landed on the box…
  await expect
    .poll(async () => (await harnessEvents(page, "onAnnotationClick")).length)
    .toBe(1);
  // …and opened nothing, navigated nowhere and selected nothing.
  expect(await openedUrls(page)).toEqual([]);
  expect(page.url()).toBe(url);
  await expect(box).toHaveAttribute("data-selected", "false");
});

test("a-bad-token and a-bad-page do not break rendering of the others", async ({
  mount,
  page,
}) => {
  await mount(<PdfHarness />);
  await waitForDocumentLoad(page);
  const root = annotatorRoot(page);

  await expect(annotationBox(root, "a-title", 0)).toHaveCount(1);
  await expect(annotationBox(root, "a-link", 0)).toHaveCount(1);
  await expect(annotationBox(root, "a-bad-token", 0)).toHaveCount(1);
  await expect(tokenRects(root, "a-title", 0)).toHaveCount(2);
  // Token 999999 does not exist; token 0 still renders.
  await expect(tokenRects(root, "a-bad-token", 0)).toHaveCount(1);
  await expect(root.locator('[data-rca-annotation="a-bad-page"]')).toHaveCount(
    0
  );
  expect(await callHandle(page, "scrollToPage", [17])).toBe(true);
  await expect(annotationBox(root, "a-far", 17)).toHaveCount(1);
});

test("zoom change with a selection does not move scrollTop to the selection", async ({
  mount,
  page,
}) => {
  await mount(<PdfHarness props={{ defaultZoom: 1 }} />);
  await waitForDocumentLoad(page);
  const root = annotatorRoot(page);
  await expect.poll(() => mountedPages(root)).toContain(0);
  await callHandle(page, "selectAnnotations", [["a-far"], { scroll: false }]);
  await expect(annotationBox(root, "a-far", 17)).toHaveCount(1);
  const before = await settledScrollTop(root);

  await callHandle(page, "setZoom", [1.5]);

  await page.waitForTimeout(RENDER_SETTLE_MS);
  expect(await settledScrollTop(root)).toBe(before);
  const range = await callHandle(page, "getVisiblePageRange", []);
  expect(range?.[1]).toBeLessThan(17);
});

test("no chrome: root has no button/input/menu/dialog with annotations shown", async ({
  mount,
  page,
}) => {
  await mount(<PdfHarness props={{ labelDisplay: "always" }} />);
  await waitForDocumentLoad(page);
  const root = annotatorRoot(page);
  await expect(annotationBox(root, "a-title", 0)).toHaveCount(1);
  await expect(root.locator("[data-rca-label-chip]").first()).toBeVisible();

  await expect(
    root.locator(
      "button, input, select, textarea, [role=button], [role=menu], [role=dialog]"
    )
  ).toHaveCount(0);
});
