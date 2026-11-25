import { expect, test } from "@playwright/experimental-ct-react";
import type { Locator, Page } from "@playwright/test";

import { DocxHarness } from "./wrappers/DocxHarness";
import { DocxParity } from "./wrappers/DocxParity";
import { IsolatedHtml } from "./wrappers/IsolatedHtml";
import { ScopedSheet } from "./wrappers/ScopedSheet";

import type { ParityReport } from "./wrappers/DocxParity";
import type { Annotation, AnnotationLabel, Highlight } from "../src/core/index";
import { setupDocxodusWasm } from "./helpers/docxodusWasm";
import { serveFixtures } from "./helpers/fixtures";
import { settledScrollTop } from "./helpers/geometry";
import {
  annotatorRoot,
  callHandle,
  harnessEvents,
  waitForDocumentLoad,
} from "./helpers/harness";

/** How far from the view's centre a centred element may be. */
const CENTRE_TOLERANCE_PX = 80;
/** Tolerance (px) of measured sizes. */
const SIZE_TOLERANCE_PX = 1;
/** A zoom at which the fixture's annotations sit below the first view. */
const TALL_ZOOM = 3;
/** A zoom at which a landscape page is well short of the viewer. */
const SMALL_ZOOM = 0.5;
/** At `TALL_ZOOM`, a horizontal scroll that shows both d-1 and d-2. */
const CLICK_SCROLL_LEFT = 300;
/** Settle time after a drag's release, and after a click (UI update). */
const SETTLE_MS = 500;
/** The fixture's labels. */
const CLAUSE_LABEL: AnnotationLabel = {
  id: "label-1",
  text: "Important Clause",
  color: "#FF6B6B",
};
/** The colour of a selected annotation's outline. */
const SELECTED_OUTLINE = "rgb(59, 130, 246)";
/**
 * What the stylesheets under `scopeElement` can reach, rules inside grouping
 * rules included, checked by the browser rather than by reading selectors:
 * each style rule's selector (pseudo-elements left out) is matched against
 * the whole page with `querySelectorAll`. Reports the matches outside the
 * scope element, the selectors that could not be matched, the kinds of rule
 * other than style rules and `@media` / `@supports` / `@container`, and the
 * style rules with nested rules.
 */
function reachOfInsertedRules(scopeElement: Locator): Promise<{
  styleRules: number;
  outside: string[];
  unmatchable: string[];
  otherKinds: string[];
  nested: string[];
}> {
  return scopeElement.evaluate((scope) => {
    const report = {
      styleRules: 0,
      outside: [] as string[],
      unmatchable: [] as string[],
      otherKinds: [] as string[],
      nested: [] as string[],
    };
    const PSEUDO_ELEMENT =
      /::?(?:before|after|first-line|first-letter|marker|placeholder|selection|backdrop)\b/gi;
    const walk = (rules: CSSRuleList) => {
      for (const rule of Array.from(rules)) {
        if (rule instanceof CSSStyleRule) {
          report.styleRules++;
          if (rule.cssRules.length > 0) report.nested.push(rule.selectorText);
          const selector = rule.selectorText.replace(PSEUDO_ELEMENT, "");
          try {
            for (const match of Array.from(
              document.querySelectorAll(selector)
            )) {
              if (!scope.contains(match)) {
                report.outside.push(`${rule.selectorText} -> ${match.tagName}`);
              }
            }
          } catch {
            report.unmatchable.push(rule.selectorText);
          }
        } else if (
          rule instanceof CSSMediaRule ||
          rule instanceof CSSSupportsRule ||
          (typeof CSSContainerRule !== "undefined" &&
            rule instanceof CSSContainerRule)
        ) {
          walk(rule.cssRules);
        } else {
          report.otherKinds.push(rule.constructor.name);
        }
      }
    };
    for (const style of Array.from(scope.querySelectorAll("style"))) {
      if (style.sheet) walk(style.sheet.cssRules);
    }
    return report;
  });
}

/**
 * Expects nothing the stylesheets under `scopeElement` hold to reach outside
 * it (see `reachOfInsertedRules`).
 */
async function expectAllScoped(scopeElement: Locator): Promise<void> {
  const reach = await reachOfInsertedRules(scopeElement);
  expect(reach.outside).toEqual([]);
  expect(reach.unmatchable).toEqual([]);
  expect(reach.otherKinds).toEqual([]);
  expect(reach.nested).toEqual([]);
}

/**
 * Answers every request to `example.invalid` (with nothing, so no failure
 * reaches the console) and returns the paths requested so far.
 */
async function recordInvalidRequests(page: Page): Promise<string[]> {
  const requested: string[] = [];
  await page.route("**/example.invalid/**", async (route) => {
    requested.push(new URL(route.request().url()).pathname);
    await route.fulfill({ status: 200, contentType: "image/gif", body: "" });
  });
  return requested;
}

/**
 * Expects the only request to `example.invalid` to be the one of the
 * control outside the document (`/control`), which shows the interception
 * works.
 */
async function expectOnlyControlRequested(
  page: Page,
  requested: string[]
): Promise<void> {
  await expect.poll(() => requested).toContain("/control");
  await page.waitForTimeout(SETTLE_MS);
  expect(requested).toEqual(["/control"]);
}

/** The inline style of a control fetched from `example.invalid/control`. */
const CONTROL_STYLE = {
  backgroundImage: "url(https://example.invalid/control)",
  width: 10,
  height: 10,
};

function bodyDisplay(page: Page): Promise<string> {
  return page.evaluate(() => getComputedStyle(document.body).display);
}

/** Where an element stands in the viewport. */
function boxOf(locator: Locator): Promise<number[]> {
  return locator.evaluate((element) => {
    const { left, top, width, height } = element.getBoundingClientRect();
    return [left, top, width, height];
  });
}

/** Well under the 5 s a bounded scroll request waits before giving up. */
const PROMPT_MS = 1000;
/** A snippet of the fixture clear of every fixture annotation. */
const SNIPPET = "sample DOCX document";

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
  await setupDocxodusWasm(page);
});

test.afterEach(() => {
  // Render failures (and React warnings) only show up in the console.
  expect(consoleProblems).toEqual([]);
});

/** The fixture's text, as the harness passes it. */
function fixtureText(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const response = await fetch("/fixtures/docx/text.txt");
    return response.text();
  });
}

/** The laid-out pages of the harness' annotator. */
function pages(page: Page, name?: string): Locator {
  // The annotator's own page container: `rca-<scope id>-page-container`.
  return annotatorRoot(page, name).locator(
    '[data-rca-docx] [class$="-page-container"]'
  );
}

/** The laid-out page boxes. */
function pageBoxes(page: Page, name?: string): Locator {
  return pages(page, name).locator('[class$="-page-box"]');
}

/** The laid-out parts of an annotation (not of a highlight with its id). */
function annotationParts(page: Page, id: string, name?: string): Locator {
  return pages(page, name).locator(
    `[data-annotation-id="${id}"]:not([data-label-id^="__"])`
  );
}

function highlightParts(page: Page, id: string): Locator {
  return pages(page).locator(
    `[data-annotation-id="${id}"][data-label-id^="__highlight"]`
  );
}

function pendingParts(page: Page): Locator {
  return pages(page).locator('[data-label-id="__pending__"]');
}

/** Where `locator`'s first element is in the root's view. */
async function inRootView(page: Page, locator: Locator) {
  const root = annotatorRoot(page);
  const box = await locator.first().evaluate((element) => {
    const { top, bottom } = element.getBoundingClientRect();
    return { top, bottom };
  });
  const view = await root.evaluate((el) => {
    const rect = el.getBoundingClientRect();
    return { top: rect.top + el.clientTop, height: el.clientHeight };
  });
  return {
    top: box.top - view.top,
    bottom: box.bottom - view.top,
    viewHeight: view.height,
  };
}

async function expectCentred(page: Page, locator: Locator): Promise<void> {
  await settledScrollTop(annotatorRoot(page));
  const { top, bottom, viewHeight } = await inRootView(page, locator);
  expect(top).toBeGreaterThanOrEqual(0);
  expect(bottom).toBeLessThanOrEqual(viewHeight);
  expect(Math.abs((top + bottom) / 2 - viewHeight / 2)).toBeLessThanOrEqual(
    CENTRE_TOLERANCE_PX
  );
}

/**
 * Expects `locator`'s first element to sit below the middle of the root's
 * view at the current scroll, so centring it would scroll the root.
 */
async function expectBelowCentre(page: Page, locator: Locator): Promise<void> {
  const { top, bottom, viewHeight } = await inRootView(page, locator);
  expect(bottom).toBeLessThanOrEqual(viewHeight);
  expect((top + bottom) / 2).toBeGreaterThan(
    viewHeight / 2 + SIZE_TOLERANCE_PX
  );
}

function scrollTop(page: Page): Promise<number> {
  return annotatorRoot(page).evaluate((el) => el.scrollTop);
}

/** Scrolls the root to the bottom, below everything the fixture annotates. */
async function scrollToBottom(page: Page): Promise<void> {
  const root = annotatorRoot(page);
  await root.evaluate((el) => el.scrollTo({ top: el.scrollHeight }));
  await settledScrollTop(root);
}

/**
 * Drags with `page.mouse` across the `occurrence`th (from 0) laid-out
 * occurrence of `snippet` (within one text node), then waits `SETTLE_MS`.
 */
async function selectSnippet(
  page: Page,
  snippet: string,
  occurrence = 0
): Promise<void> {
  const container = pages(page);
  const { from, to } = await container.evaluate(
    (el, [wanted, nth]) => {
      const walker = el.ownerDocument.createTreeWalker(
        el,
        NodeFilter.SHOW_TEXT
      );
      let seen = 0;
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const value = node.textContent ?? "";
        for (
          let at = value.indexOf(wanted);
          at >= 0;
          at = value.indexOf(wanted, at + 1)
        ) {
          if (seen++ < nth) continue;
          const range = el.ownerDocument.createRange();
          range.setStart(node, at);
          range.setEnd(node, at + wanted.length);
          const rects = Array.from(range.getClientRects());
          const first = rects[0];
          const last = rects[rects.length - 1];
          return {
            from: { x: first.left + 1, y: first.top + first.height / 2 },
            to: { x: last.right - 1, y: last.top + last.height / 2 },
          };
        }
      }
      throw new Error(`"${wanted}" #${nth} is not laid out`);
    },
    [snippet, occurrence] as const
  );
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(SETTLE_MS);
}

/** The offsets of the first occurrence of `snippet` in the fixture text. */
async function spanOf(
  page: Page,
  snippet: string
): Promise<{ start: number; end: number }> {
  const start = (await fixtureText(page)).indexOf(snippet);
  if (start < 0) throw new Error(`"${snippet}" is not in the fixture text`);
  return { start, end: start + snippet.length };
}

/**
 * The first laid-out part's outline, `"<width> <color>"`, once it has
 * stopped changing (outlines change with a short transition).
 */
async function outline(locator: Locator): Promise<string> {
  const read = () =>
    locator.first().evaluate((element) => {
      const style = getComputedStyle(element);
      return `${style.outlineWidth} ${style.outlineColor}`;
    });
  let last = await read();
  for (;;) {
    await locator.page().waitForTimeout(SETTLE_MS / 2);
    const next = await read();
    if (next === last) return next;
    last = next;
  }
}

/**
 * Clicks the middle of `locator`'s first element with `page.mouse` (holding
 * Ctrl/Cmd when `toggle`), then waits `SETTLE_MS`. Not `locator.click()`,
 * which scrolls an element it deems partly hidden into view first.
 */
async function clickOn(
  locator: Locator,
  { toggle = false }: { toggle?: boolean } = {}
): Promise<void> {
  const page = locator.page();
  const box = await locator.first().boundingBox();
  if (!box) throw new Error("nothing to click");
  if (toggle) await page.keyboard.down("ControlOrMeta");
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  if (toggle) await page.keyboard.up("ControlOrMeta");
  await page.waitForTimeout(SETTLE_MS);
}

/** Moves the pointer off the document (no hover outline). */
async function pointerAway(page: Page): Promise<void> {
  await page.mouse.move(1200, 880);
}

test("renders the document; onDocumentLoad fires with pageCount null and the text", async ({
  mount,
  page,
}) => {
  await mount(<DocxHarness />);
  await waitForDocumentLoad(page);
  const text = await fixtureText(page);

  expect(await harnessEvents(page, "onDocumentLoad")).toEqual([
    ["onDocumentLoad", { pageCount: null, text }],
  ]);
  await expect(pages(page)).toContainText("Hello World.");
  await expect(pages(page)).toContainText("The Definition section explains");
  await expect(pageBoxes(page)).toHaveCount(1);
});

test("annotations d-1 and d-2 are projected as [data-annotation-id]", async ({
  mount,
  page,
}) => {
  await mount(<DocxHarness />);
  await waitForDocumentLoad(page);

  await expect(annotationParts(page, "d-1")).toHaveText(["Hello World"]);
  await expect(annotationParts(page, "d-2")).toHaveText(["Important Clause"]);
  await expect(annotationParts(page, "d-1")).toHaveAttribute(
    "data-label-id",
    "label-1"
  );
  // d-3 is structural, hidden by default.
  await expect(annotationParts(page, "d-3")).toHaveCount(0);
  // Projecting adds no text: the paragraph d-1 starts reads as it did.
  expect(await pages(page).locator("p").first().innerText()).toBe(
    "Hello World. This is a sample DOCX document for testing."
  );
});

test("d-bad-span is skipped and the others still render", async ({
  mount,
  page,
}) => {
  await mount(<DocxHarness annotationIds={["d-1", "d-bad-span", "d-2"]} />);
  await waitForDocumentLoad(page);

  await expect(annotationParts(page, "d-1")).toHaveCount(1);
  await expect(annotationParts(page, "d-2")).toHaveCount(1);
  await expect(
    annotatorRoot(page).locator('[data-annotation-id="d-bad-span"]')
  ).toHaveCount(0);
  expect(await callHandle(page, "scrollToAnnotation", ["d-bad-span"])).toBe(
    false
  );
});

test("scrollToAnnotation('d-2') resolves true and the element is in view", async ({
  mount,
  page,
}) => {
  await mount(<DocxHarness props={{ defaultZoom: TALL_ZOOM }} />);
  await waitForDocumentLoad(page);
  await scrollToBottom(page);
  const before = await inRootView(page, annotationParts(page, "d-2"));
  expect(before.bottom).toBeLessThan(0);

  expect(
    await callHandle(page, "scrollToAnnotation", [
      "d-2",
      { behavior: "instant" },
    ])
  ).toBe(true);
  await expectCentred(page, annotationParts(page, "d-2"));

  // Smooth (the default) lands too, and resolves only once it has.
  await scrollToBottom(page);
  expect(await callHandle(page, "scrollToAnnotation", ["d-1"])).toBe(true);
  await expectCentred(page, annotationParts(page, "d-1"));
});

test("span highlight is painted; activeHighlightId scrolls to it", async ({
  mount,
  page,
}) => {
  const harness = (
    activeHighlightId: string | null,
    highlights?: Highlight[]
  ) => (
    <DocxHarness
      props={{ defaultZoom: TALL_ZOOM, highlights, activeHighlightId }}
    />
  );
  const component = await mount(harness(null));
  await waitForDocumentLoad(page);
  const highlight: Highlight = {
    id: "h-1",
    color: "#16a34a",
    target: { kind: "span", ...(await spanOf(page, SNIPPET)) },
  };
  await component.update(harness(null, [highlight]));

  const parts = highlightParts(page, "h-1");
  await expect(parts).toHaveText([SNIPPET]);
  await expect(parts).toHaveAttribute("data-label-id", "__highlight__");
  // In its own colour.
  expect(
    await parts.first().evaluate((el) => getComputedStyle(el).borderBottomColor)
  ).toBe("rgb(22, 163, 74)");

  await scrollToBottom(page);
  await component.update(harness("h-1", [highlight]));
  await expect(parts).toHaveAttribute("data-label-id", "__highlight_active__");
  await expectCentred(page, parts);

  // And through the handle.
  await scrollToBottom(page);
  expect(await callHandle(page, "scrollToHighlight", ["h-1"])).toBe(true);
  await expectCentred(page, parts);
});

test("click selects (uncontrolled); ctrl-click toggles; click on plain text clears", async ({
  mount,
  page,
}) => {
  await mount(<DocxHarness props={{ defaultZoom: TALL_ZOOM }} />);
  await waitForDocumentLoad(page);
  // Both annotations in view, and d-2 low enough that a scroll to the
  // selection (d-2 first) would show.
  await annotatorRoot(page).evaluate((el, left) => {
    el.scrollLeft = left;
  }, CLICK_SCROLL_LEFT);
  await expectBelowCentre(page, annotationParts(page, "d-2"));
  const selection = () => callHandle(page, "getSelectedAnnotationIds", []);

  await clickOn(annotationParts(page, "d-2"));
  expect(await selection()).toEqual(["d-2"]);
  // A user click does not scroll.
  expect(await settledScrollTop(annotatorRoot(page))).toBe(0);
  await clickOn(annotationParts(page, "d-1"), { toggle: true });
  expect(await selection()).toEqual(["d-2", "d-1"]);
  await clickOn(annotationParts(page, "d-2"), { toggle: true });
  expect(await selection()).toEqual(["d-1"]);
  await clickOn(annotationParts(page, "d-2"));
  expect(await selection()).toEqual(["d-2"]);

  await pointerAway(page);
  expect(await outline(annotationParts(page, "d-2"))).toBe(
    `2px ${SELECTED_OUTLINE}`
  );
  expect(await outline(annotationParts(page, "d-1"))).not.toContain(
    SELECTED_OUTLINE
  );

  await clickOn(pages(page).getByText("section explains key terms"));
  expect(await selection()).toEqual([]);

  expect(await harnessEvents(page, "onSelectionChange")).toEqual([
    ["onSelectionChange", ["d-2"], { source: "user" }],
    ["onSelectionChange", ["d-2", "d-1"], { source: "user" }],
    ["onSelectionChange", ["d-1"], { source: "user" }],
    ["onSelectionChange", ["d-2"], { source: "user" }],
    ["onSelectionChange", [], { source: "user" }],
  ]);
  const clicked = (await harnessEvents(page, "onAnnotationClick")).map(
    ([, annotation]) => (annotation as { id: string }).id
  );
  expect(clicked).toEqual(["d-2", "d-1", "d-2", "d-2"]);
  // Nor did any later one.
  expect(await scrollTop(page)).toBe(0);
  expect(await annotatorRoot(page).evaluate((el) => el.scrollLeft)).toBe(
    CLICK_SCROLL_LEFT
  );
});

test("controlled selection: click fires onSelectionChange and DOM selection state follows the prop only", async ({
  mount,
  page,
}) => {
  const component = await mount(
    <DocxHarness mode="controlled" props={{ zoom: TALL_ZOOM }} />
  );
  await waitForDocumentLoad(page);
  await annotatorRoot(page).evaluate((el, left) => {
    el.scrollLeft = left;
  }, CLICK_SCROLL_LEFT);
  await expectBelowCentre(page, annotationParts(page, "d-2"));

  await clickOn(annotationParts(page, "d-2"));
  await pointerAway(page);
  expect(await harnessEvents(page, "onSelectionChange")).toEqual([
    ["onSelectionChange", ["d-2"], { source: "user" }],
  ]);
  expect(await callHandle(page, "getSelectedAnnotationIds", [])).toEqual([]);
  expect(await outline(annotationParts(page, "d-2"))).not.toContain(
    SELECTED_OUTLINE
  );

  // The host applies the change: the echo of a user click does not scroll.
  await component.update(
    <DocxHarness
      mode="controlled"
      props={{ zoom: TALL_ZOOM, selectedAnnotationIds: ["d-2"] }}
    />
  );
  await expect
    .poll(() => outline(annotationParts(page, "d-2")))
    .toBe(`2px ${SELECTED_OUTLINE}`);
  expect(await callHandle(page, "getSelectedAnnotationIds", [])).toEqual([
    "d-2",
  ]);
  expect(await settledScrollTop(annotatorRoot(page))).toBe(0);
});

test("a selection present at mount scrolls to it once the document has loaded", async ({
  mount,
  page,
}) => {
  await mount(
    <DocxHarness
      props={{ defaultZoom: TALL_ZOOM, defaultSelectedAnnotationIds: ["d-2"] }}
    />
  );
  await waitForDocumentLoad(page);
  await expectCentred(page, annotationParts(page, "d-2"));
  expect(await scrollTop(page)).toBeGreaterThan(0);
});

test("scrollToAnnotation(id, { select: true }) reveals a hidden structural annotation", async ({
  mount,
  page,
}) => {
  await mount(<DocxHarness props={{ defaultZoom: TALL_ZOOM }} />);
  await waitForDocumentLoad(page);
  await expect(annotationParts(page, "d-3")).toHaveCount(0);

  expect(
    await callHandle(page, "scrollToAnnotation", [
      "d-3",
      { select: true, behavior: "instant" },
    ])
  ).toBe(true);
  await expect(annotationParts(page, "d-3")).toHaveText(["The Definition"]);
  await expectCentred(page, annotationParts(page, "d-3"));
  expect(await callHandle(page, "getSelectedAnnotationIds", [])).toEqual([
    "d-3",
  ]);
});

test("selecting text -> onTextSelect with start/end matching text.slice(start,end) === rawText", async ({
  mount,
  page,
}) => {
  await mount(<DocxHarness />);
  await waitForDocumentLoad(page);
  const text = await fixtureText(page);

  type Pending = {
    json: { start: number; end: number };
    rawText: string;
    page: number;
  };
  const selected = async () =>
    ((await harnessEvents(page, "onTextSelect")).at(-1)?.[1] ??
      null) as Pending | null;

  // "This" occurs twice (offsets 13 and 57): the one selected is meant.
  await selectSnippet(page, "This", 1);
  const pending = await selected();
  expect(pending).toMatchObject({
    json: { start: 57, end: 61 },
    rawText: "This",
    page: 0,
    annotationLabel: null,
  });
  expect(text.slice(57, 61)).toBe(pending?.rawText);
  await selectSnippet(page, "This", 0);
  expect((await selected())?.json).toEqual({ start: 13, end: 17 });

  await selectSnippet(page, SNIPPET);
  const second = (await selected()) as Pending;
  const span = await spanOf(page, SNIPPET);
  expect(second.json).toEqual(span);
  expect(text.slice(second.json.start, second.json.end)).toBe(second.rawText);
  // No slot and no active label: it stays pending, painted.
  expect(await callHandle(page, "getPendingSelection", [])).toMatchObject({
    json: span,
  });
  await expect(pendingParts(page)).toHaveText([SNIPPET]);
});

test("outcome 2 with activeLabel -> onCreateAnnotation with json {start,end}", async ({
  mount,
  page,
}) => {
  await mount(<DocxHarness props={{ activeLabel: CLAUSE_LABEL }} />);
  await waitForDocumentLoad(page);

  await selectSnippet(page, SNIPPET);
  expect(await harnessEvents(page, "onCreateAnnotation")).toEqual([
    [
      "onCreateAnnotation",
      {
        json: await spanOf(page, SNIPPET),
        rawText: SNIPPET,
        page: 0,
        annotationLabel: CLAUSE_LABEL,
      },
    ],
  ]);
  expect(await callHandle(page, "getPendingSelection", [])).toBeNull();
  await expect(pendingParts(page)).toHaveCount(0);
});

test("outcome 1 with renderSelectionMenu -> slot shown, pending stays painted, commit creates", async ({
  mount,
  page,
}) => {
  await mount(
    <DocxHarness
      selectionMenu
      addCreated
      props={{ activeLabel: CLAUSE_LABEL }}
    />
  );
  await waitForDocumentLoad(page);

  await selectSnippet(page, SNIPPET);
  const menu = page.locator("[data-harness-menu]");
  await expect(menu).toBeVisible();
  expect(await harnessEvents(page, "onCreateAnnotation")).toEqual([]);
  // Painted by the projection once the native selection is gone.
  await expect(pendingParts(page)).toHaveText([SNIPPET]);
  expect(await page.evaluate(() => getSelection()?.toString() ?? "")).toBe("");

  await page.locator("[data-harness-apply]").click();
  await expect(menu).toHaveCount(0);
  expect(await harnessEvents(page, "onCreateAnnotation")).toEqual([
    [
      "onCreateAnnotation",
      {
        json: await spanOf(page, SNIPPET),
        rawText: SNIPPET,
        page: 0,
        annotationLabel: CLAUSE_LABEL,
      },
    ],
  ]);
  await expect(annotationParts(page, "created-1")).toHaveText([SNIPPET]);
  await expect(pendingParts(page)).toHaveCount(0);
});

test("showStructural toggles structural spans; visibleLabelIds filters; selected stays visible when filtered", async ({
  mount,
  page,
}) => {
  const component = await mount(<DocxHarness />);
  await waitForDocumentLoad(page);
  await expect(annotationParts(page, "d-3")).toHaveCount(0);

  await component.update(<DocxHarness props={{ showStructural: true }} />);
  await expect(annotationParts(page, "d-3")).toHaveText(["The Definition"]);

  await component.update(
    <DocxHarness
      props={{ showStructural: true, visibleLabelIds: ["label-2"] }}
    />
  );
  await expect(annotationParts(page, "d-1")).toHaveCount(0);
  await expect(annotationParts(page, "d-3")).toHaveCount(0);
  await expect(annotationParts(page, "d-2")).toHaveCount(1);

  await component.update(
    <DocxHarness
      props={{
        showStructural: true,
        visibleLabelIds: ["label-2"],
        selectedAnnotationIds: ["d-1"],
      }}
    />
  );
  await expect(annotationParts(page, "d-1")).toHaveText(["Hello World"]);
  await expect(annotationParts(page, "d-3")).toHaveCount(0);
});

test("labelDisplay 'hide' removes label chips; any other value shows them", async ({
  mount,
  page,
}) => {
  const chip = () =>
    annotationParts(page, "d-1")
      .first()
      .evaluate((el) => getComputedStyle(el, "::before").content);
  const component = await mount(<DocxHarness />);
  await waitForDocumentLoad(page);
  expect(await chip()).toBe('"Important Clause"');

  await component.update(<DocxHarness props={{ labelDisplay: "hide" }} />);
  await expect.poll(chip).toBe("none");
  // The annotation itself is still drawn.
  expect(
    await annotationParts(page, "d-1")
      .first()
      .evaluate((el) => getComputedStyle(el).borderBottomStyle)
  ).toBe("solid");

  await component.update(<DocxHarness props={{ labelDisplay: "always" }} />);
  await expect.poll(chip).toBe('"Important Clause"');
});

test("setZoom(1.5) scales the document; setZoom('fit-width') -> getZoom() === 1", async ({
  mount,
  page,
}) => {
  await mount(<DocxHarness />);
  await waitForDocumentLoad(page);
  expect(await callHandle(page, "getZoom", [])).toBe(1);
  const pageBox = pageBoxes(page);
  const width = async () => (await pageBox.boundingBox())?.width ?? 0;
  const natural = await width();
  expect(natural).toBeGreaterThan(0);

  await callHandle(page, "setZoom", [1.5]);
  await expect
    .poll(async () => Math.abs((await width()) - natural * 1.5))
    .toBeLessThanOrEqual(SIZE_TOLERANCE_PX);
  // Wider than the view, the page starts inside it: none of it is out of
  // reach to the left.
  const rootBox = await annotatorRoot(page).boundingBox();
  const pageLeft = (await pageBox.boundingBox())?.x ?? -Infinity;
  expect(pageLeft).toBeGreaterThanOrEqual(rootBox?.x ?? 0);
  expect(await callHandle(page, "getZoom", [])).toBe(1.5);
  const zoomEvents = await harnessEvents(page, "onZoomChange");
  expect(zoomEvents.at(-1)).toEqual(["onZoomChange", 1.5]);
  // Annotations survive the new layout.
  await expect(annotationParts(page, "d-1")).toHaveCount(1);

  await callHandle(page, "setZoom", ["fit-width"]);
  expect(await callHandle(page, "getZoom", [])).toBe(1);
});

test("findText returns span highlights whose slices equal the query", async ({
  mount,
  page,
}) => {
  const component = await mount(<DocxHarness />);
  await waitForDocumentLoad(page);
  const text = await fixtureText(page);

  const found = await callHandle(page, "findText", [
    "This",
    { caseSensitive: true },
  ]);
  expect(found.map((h) => h.id)).toEqual(["find-0", "find-1"]);
  for (const highlight of found) {
    if (highlight.target.kind !== "span") throw new Error("not a span");
    expect(text.slice(highlight.target.start, highlight.target.end)).toBe(
      "This"
    );
  }
  const insensitive = await callHandle(page, "findText", ["important clause"]);
  expect(insensitive).toHaveLength(1);
  expect(await callHandle(page, "findText", ["nowhere"])).toEqual([]);

  // Passed back, they are painted.
  await component.update(<DocxHarness props={{ highlights: found }} />);
  await expect(highlightParts(page, "find-0")).toHaveText(["This"]);
  await expect(highlightParts(page, "find-1")).toHaveText(["This"]);
});

test("getPageCount() null, scrollToPage(1) false", async ({ mount, page }) => {
  await mount(<DocxHarness />);
  await waitForDocumentLoad(page);
  expect(await callHandle(page, "getPageCount", [])).toBeNull();
  expect(await callHandle(page, "getVisiblePageRange", [])).toBeNull();
  expect(await callHandle(page, "scrollToPage", [1])).toBe(false);
});

test("no chrome in the root", async ({ mount, page }) => {
  await mount(<DocxHarness props={{ labelDisplay: "always" }} />);
  await waitForDocumentLoad(page);
  await expect(annotationParts(page, "d-1")).toHaveCount(1);

  const root = annotatorRoot(page);
  await expect(
    root.locator(
      "button, input, select, textarea, [role=button], [role=menu], [role=dialog]"
    )
  ).toHaveCount(0);
  // The document's own text and its page number, nothing else.
  const text = await fixtureText(page);
  const shown = (await pages(page).innerText()).replace(/\s+/g, " ").trim();
  expect(shown).toBe(`${text.replace(/\s+/g, " ").trim()} 1`);
});

test("two viewers: selecting in one does not style the other", async ({
  mount,
  page,
}) => {
  await mount(
    <div style={{ display: "flex" }}>
      <DocxHarness name="left" />
      <DocxHarness name="right" />
    </div>
  );
  await waitForDocumentLoad(page, "left");
  await waitForDocumentLoad(page, "right");

  await clickOn(annotationParts(page, "d-1", "left"));
  await pointerAway(page);
  expect(await outline(annotationParts(page, "d-1", "left"))).toBe(
    `2px ${SELECTED_OUTLINE}`
  );
  expect(await outline(annotationParts(page, "d-1", "right"))).not.toContain(
    SELECTED_OUTLINE
  );
  expect(
    await callHandle(page, "getSelectedAnnotationIds", [], "right")
  ).toEqual([]);
});

test("two different documents side by side keep their own styles, and the host keeps its own", async ({
  mount,
  page,
}) => {
  await mount(
    <div>
      {/* Host CSS for docxodus' default class names. */}
      <style>
        {".page-box { outline: 7px solid red } " +
          ".docx-Normal { color: rgb(255, 0, 0) }"}
      </style>
      <div data-probes="">
        <span className="page-content">probe</span>
        <table>
          <tbody>
            <tr>
              <td>cell</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div style={{ display: "flex" }}>
        <DocxHarness name="left" />
        <DocxHarness name="right" fixture="landscape" />
      </div>
    </div>
  );
  await waitForDocumentLoad(page, "left");
  await waitForDocumentLoad(page, "right");

  // Each page has its own document's geometry (Letter portrait at 96 dpi,
  // Letter landscape) and its paragraphs their own style (11pt Cambria,
  // 16pt Arial), though both documents style a "Normal" paragraph.
  const size = async (name: string) => {
    const box = await pageBoxes(page, name).first().boundingBox();
    return [Math.round(box?.width ?? 0), Math.round(box?.height ?? 0)];
  };
  expect(await size("left")).toEqual([816, 1056]);
  expect(await size("right")).toEqual([1056, 816]);
  const paragraph = (name: string) =>
    pages(page, name)
      .locator("p")
      .first()
      .evaluate((p) => {
        const style = getComputedStyle(p);
        return [style.fontSize, style.fontFamily];
      });
  expect(await paragraph("left")).toEqual(["14.6667px", "Cambria, serif"]);
  expect(await paragraph("right")).toEqual(["21.3333px", "Arial, sans-serif"]);
  // The host's rules for docxodus' default class names miss the documents,
  // whose classes are their annotator's own.
  for (const name of ["left", "right"]) {
    expect(
      await pageBoxes(page, name)
        .first()
        .evaluate((box) => getComputedStyle(box).outlineStyle)
    ).toBe("none");
    expect(
      await pages(page, name)
        .locator("p")
        .first()
        .evaluate((p) => getComputedStyle(p).color)
    ).not.toBe("rgb(255, 0, 0)");
  }

  // Nothing outside the annotators is restyled by either document.
  const probes = await page.locator("[data-probes]").evaluate((el) => {
    const span = getComputedStyle(el.querySelector("span") as Element);
    const table = getComputedStyle(el.querySelector("table") as Element);
    const body = getComputedStyle(document.body);
    return {
      spanPosition: span.position,
      spanWhiteSpace: span.whiteSpace,
      tableMaxWidth: table.maxWidth,
      bodyMargin: body.margin,
      bodyFont: body.fontFamily,
    };
  });
  expect(probes).toEqual({
    spanPosition: "static",
    spanWhiteSpace: "normal",
    tableMaxWidth: "none",
    bodyMargin: "8px",
    bodyFont: await page.evaluate(() => {
      const fresh = document.createElement("iframe");
      document.body.append(fresh);
      const font = getComputedStyle(
        fresh.contentDocument?.body as HTMLElement
      ).fontFamily;
      fresh.remove();
      return font;
    }),
  });
});

test("with showStructural on, a structural paragraph gives way to an annotation sharing its start", async ({
  mount,
  page,
}) => {
  const paragraph: Annotation = {
    id: "s-para",
    annotationLabel: { id: "label-2", text: "Paragraph" },
    json: { start: 0, end: 56 },
    structural: true,
  };
  await mount(
    <DocxHarness
      annotationIds={["d-1", "d-2"]}
      extraAnnotations={[paragraph]}
      props={{ showStructural: true }}
    />
  );
  await waitForDocumentLoad(page);

  await expect(annotationParts(page, "d-1")).toHaveText(["Hello World"]);
  await expect(annotationParts(page, "d-2")).toHaveText(["Important Clause"]);
  await expect(annotationParts(page, "s-para")).toHaveCount(0);
});

test("scrollToAnnotation on a span the engine did not draw resolves false at once", async ({
  mount,
  page,
}) => {
  // Overlaps d-1, which starts first: docxodus draws d-1 only.
  const over: Annotation = {
    id: "d-over",
    annotationLabel: { id: "label-2", text: "Definition" },
    json: { start: 5, end: 20 },
  };
  await mount(<DocxHarness extraAnnotations={[over]} />);
  await waitForDocumentLoad(page);
  await expect(annotationParts(page, "d-1")).toHaveCount(1);
  await expect(annotationParts(page, "d-over")).toHaveCount(0);

  const elapsed = await page.evaluate(async () => {
    const started = performance.now();
    const result = await window.__rca?.scrollToAnnotation("d-over");
    return { result, ms: performance.now() - started };
  });
  expect(elapsed.result).toBe(false);
  expect(elapsed.ms).toBeLessThan(PROMPT_MS);
});

test("annotations are drawn on a document whose HTML has a line break, table columns and an image", async ({
  mount,
  page,
}) => {
  // features.txt: a paragraph or table cell per line.
  const text = [
    "Features",
    "Heading 1",
    "Heading 2",
    "bold italic underlined struck supersub\tafter a tab",
    "after a break",
    "First item",
    "Nested item",
    "Term",
    "Meaning",
    "Spanning both columns",
  ].join("\n");
  const spanOfText = (rawText: string, id: string): Annotation => {
    const start = text.indexOf(rawText);
    return {
      id,
      annotationLabel: CLAUSE_LABEL,
      rawText,
      json: { start, end: start + rawText.length },
    };
  };
  await mount(
    <DocxHarness
      fixture="features"
      extraAnnotations={[
        spanOfText("after a break", "f-break"),
        spanOfText("Spanning both columns", "f-cell"),
      ]}
    />
  );
  await waitForDocumentLoad(page);

  await expect(annotationParts(page, "f-break")).toHaveText(["after a break"]);
  await expect(annotationParts(page, "f-cell")).toHaveText([
    "Spanning both columns",
  ]);
  // The document itself is as it was: its break, its table and its image.
  await expect(pages(page).locator("br")).toHaveCount(1);
  await expect(pages(page).locator("td")).toHaveCount(6);
  await expect(pages(page).locator("img")).toHaveCount(1);
});

test("an annotation across runs of different formatting is drawn, a part per run", async ({
  mount,
  page,
}) => {
  // The first runs of the fixture's fourth paragraph, each ending in a
  // space: docxodus writes that space as a no-break space in its HTML.
  const rawText = "bold italic underlined";
  const start = "Features\nHeading 1\nHeading 2\n".length;
  await mount(
    <DocxHarness
      fixture="features"
      extraAnnotations={[
        {
          id: "f-runs",
          annotationLabel: CLAUSE_LABEL,
          rawText,
          json: { start, end: start + rawText.length },
        },
      ]}
    />
  );
  await waitForDocumentLoad(page);

  await expect(annotationParts(page, "f-runs")).toHaveText([
    "bold",
    "italic",
    "underlined",
  ]);
  expect(await callHandle(page, "scrollToAnnotation", ["f-runs"])).toBe(true);
});

test("with showStructural on, a structural paragraph gives way to an annotation strictly inside it", async ({
  mount,
  page,
}) => {
  // The whole second paragraph; d-2 ("Important Clause") lies strictly
  // inside it, sharing neither end. docxodus would draw only the paragraph.
  const paragraph: Annotation = {
    id: "s-para-2",
    annotationLabel: { id: "label-1", text: "Paragraph" },
    json: { start: 57, end: 126 },
    structural: true,
  };
  await mount(
    <DocxHarness
      annotationIds={["d-1", "d-2"]}
      extraAnnotations={[paragraph]}
      props={{ showStructural: true }}
    />
  );
  await waitForDocumentLoad(page);

  await expect(annotationParts(page, "d-2")).toHaveText(["Important Clause"]);
  await expect(annotationParts(page, "s-para-2")).toHaveCount(0);
});

test("a hostile label id puts no rule on the page: the only stylesheets are the annotator's two, scoped", async ({
  mount,
  page,
}) => {
  const hostile: Annotation = {
    id: "d-hostile",
    annotationLabel: {
      id: "x{}body{display:none}.y",
      text: "</style><b>",
      color: "red;}body{display:none",
    },
    json: { start: 23, end: 29 },
  };
  await mount(
    <DocxHarness annotationIds={["d-1"]} extraAnnotations={[hostile]} />
  );
  await waitForDocumentLoad(page);
  await expect(annotationParts(page, "d-hostile")).toHaveText(["sample"]);

  const docx = annotatorRoot(page).locator("[data-rca-docx]");
  // The document's stylesheet and the format's, nothing projection added.
  await expect(docx.locator("style")).toHaveCount(2);
  // Inside grouping rules (the document's `@media print`) too.
  await expectAllScoped(docx);
  expect(
    await page.evaluate(() => getComputedStyle(document.body).display)
  ).toBe("block");
});

/**
 * Stylesheets crafted to break out of a scope, to fetch, or to take a name
 * the host page uses, as a document could carry; an array is a document
 * with several `<style>` blocks.
 */
const HOSTILE_SHEETS: Record<string, string | string[]> = {
  // An unescaped line break ends a CSS string: docxodus writes a font name
  // as is, so one with a line break opens rules of its own.
  "a line break in a string":
    "p.docx-Normal { font-family: 'Evil\n} body { display: none } .z { a: ', serif; }",
  // An unquoted url( runs on over braces and quotes.
  "an unquoted url(": 'p{a:url(x}q{b:") } body{display:none} q2{c:"}',
  // Chromium writes a custom property's value back as its source text,
  // unterminated string or url( and all, and moves !important ones last.
  "an unterminated string in a custom property":
    'p { --y: ")} body{display:none} q{" !important; --x: "abc',
  "an unterminated url( in a custom property":
    'p { --y: ")} body{display:none} q{" !important; --x: url(abc',
  "a custom property inside @media":
    '@media all { p { --y: ")} body{display:none} q{" !important; --x: "abc',
  "a custom property inside @supports":
    '@supports (color: red) { p { --y: ")} body{display:none} q{" !important; --x: "abc',
  // The one custom property a document keeps must hold a number.
  "the kept custom property with a string":
    'p { --docx-auto-line-spacing: ")} body{display:none} q{" !important; --docx-auto-line-spacing: "abc',
  // A value holding var() is also written back as its source text.
  "an unterminated string in a value holding var()":
    'p { color: var(--a, ")} body{display:none} q{") !important; background: var(--b, "abc',
  // Selectors that would reach the scope element's siblings once prefixed.
  "leading combinators and nesting":
    "~ div { display: none } + div { display: none }" +
    " body { color: blue; & ~ * { display: none } }" +
    " :root { & + * { display: none } }" +
    " @media all { ~ div { display: none } body { & ~ * { display: none } } }",
  // Two blocks: the url( left open by the first runs on over the join into
  // the text of the second, whose string then ends it.
  "an open url( in one stylesheet, ended in the next": [
    "p { background-image: env(x, url(data:abc",
    'p { content: ")) } body { display: none } x { " }',
  ],
  // A substitution function carries its fallback as source text, CSS
  // escapes and all: `u\72l(` is `url(` once it is parsed again.
  "a url() spelt with an escape in the fallback of env()":
    "p { background-image: env(nope, u\\72l(https://example.invalid/env1)) }",
  "a url() spelt with an escape inside if()":
    "p { background-image: if(else: u\\72l(https://example.invalid/if1)) }",
  "a url() spelt with an escape in the fallback of var()":
    "p { background-image: var(--nope, u\\72l(https://example.invalid/var1)); color: var(--nope, red) }",
  // Chromium lists !important declarations last when the block holds a
  // custom property, so the string that hid a declaration is cut open.
  "a declaration smuggled in a string split by !important":
    'p { --z: 1; color: env(x) "; background-image: u\\72l(https://example.invalid/smuggled); x: " !important; background-color: env(x) "abc',
  "a rule smuggled in a string split by !important":
    'p { --z: 1; color: env(x) ")} body{display:none} q{" !important; background-color: env(x) "abc',
  // Anchor names belong to the whole page: the host's box positioned
  // against `--menu` would move onto the document's paragraph.
  "an anchor name the host positions against":
    "p { anchor-name: --menu; color: red }",
  "the other names shared with the page":
    "p { view-transition-name: hero; container-name: host; container-type: size;" +
    " counter-increment: host 5; counter-reset: host; page: host; anchor-scope: all;" +
    " position-anchor: --menu; animation-name: host; timeline-scope: --host; color: red }",
  // Shorthands that set a longhand off the allow-list, and `all`.
  "images through shorthands":
    "p { background: red url(https://example.invalid/bg); list-style: url(https://example.invalid/ls) inside;" +
    " border-image: url(https://example.invalid/bi) 1; mask: url(https://example.invalid/mask); all: initial;" +
    " cursor: url(https://example.invalid/cursor), auto; -webkit-box-reflect: below 0 url(https://example.invalid/reflect) }" +
    " p::before { content: url(https://example.invalid/content) }",
  // What a kept at-rule's condition can carry.
  "conditions carrying text": [
    '@supports (--x: ")} body{display:none} q{(") { p { color: red } }',
    "@media (min-width: env(x, u\\72l(https://example.invalid/mq))) { p { background-image: url(https://example.invalid/mq2) } }",
    "@container style(--x: url(https://example.invalid/cq)) { body { display: none } }",
    "@supports selector(body) { body { display: none } }",
  ],
  // At-rules that act on the whole page or fetch, also inside kept ones.
  "at-rules for the whole page":
    "@import url(https://example.invalid/import.css);" +
    " @font-face { font-family: leak; src: url(https://example.invalid/font.woff2) } p { font-family: leak }" +
    " @layer x { body { display: none } } @scope (body) { :scope { display: none } }" +
    ' @starting-style { body { display: none } } @page { margin: 0 } @property --p { syntax: "*"; inherits: true }' +
    " @media all { @layer y { body { display: none } } @font-face { font-family: leak2; src: url(https://example.invalid/font2.woff2) }" +
    " @scope (html) { body { display: none } } p { font-family: leak2 } }",
};

for (const [name, css] of Object.entries(HOSTILE_SHEETS)) {
  test(`the scoper keeps a hostile stylesheet to its scope: ${name}`, async ({
    mount,
    page,
  }) => {
    const requested = await recordInvalidRequests(page);
    await mount(<ScopedSheet css={css} scopeId="scoper-test" />);
    const scopeElement = page.locator('[data-rca-docx="scoper-test"]');
    await expect(scopeElement.locator("style")).toHaveCount(1);

    expect(await bodyDisplay(page)).toBe("block");
    await expectAllScoped(scopeElement);
    for (const probe of ["[data-probe-sibling]", "[data-probe-z]"]) {
      expect(
        await page.locator(probe).evaluate((el) => getComputedStyle(el).display)
      ).toBe("block");
    }
    // The host's box positioned against the anchor `--menu` stands where
    // the one positioned against a name nothing has stands.
    expect(await boxOf(page.locator("[data-probe-anchored]"))).toEqual(
      await boxOf(page.locator("[data-probe-unanchored]"))
    );
    // Nothing the stylesheet named was fetched.
    await expectOnlyControlRequested(page, requested);
  });
}

test("the scoper drops a stylesheet that does not parse back to its rules: a namespace prefix", async ({
  mount,
  page,
}) => {
  const NAMESPACE = '@namespace svg "http://www.w3.org/2000/svg";';
  const requested = await recordInvalidRequests(page);
  await mount(
    <div>
      {/* Scoped, the rule `svg|a` stands in a stylesheet without the
          @namespace rule that declared its prefix (at-rules of that kind
          are dropped), so the browser's parser drops it: the stylesheet
          inserted would not be the one written, and none of it is kept. */}
      <ScopedSheet
        css={`
          ${NAMESPACE} svg|a {
            color: rgb(1, 2, 3);
          }
          p {
            color: rgb(1, 2, 3);
          }
        `}
        scopeId="scoper-rejected"
      />
      {/* Without the prefixed rule the same stylesheet is kept. */}
      <ScopedSheet
        css={`
          ${NAMESPACE} p {
            color: rgb(1, 2, 3);
          }
        `}
        scopeId="scoper-kept"
      />
    </div>
  );
  const colour = (scopeElement: Locator) =>
    scopeElement.locator("p").evaluate((el) => getComputedStyle(el).color);

  const rejected = page.locator('[data-rca-docx="scoper-rejected"]');
  await expect(rejected).toHaveAttribute("data-css-rejected", "true");
  expect(await rejected.locator("style").textContent()).toBe("");
  await expect(rejected.locator("p")).toHaveText("inside");
  expect(await colour(rejected)).not.toBe("rgb(1, 2, 3)");

  const kept = page.locator('[data-rca-docx="scoper-kept"]');
  await expect(kept).toHaveAttribute("data-css-rejected", "false");
  expect(await colour(kept)).toBe("rgb(1, 2, 3)");
  await expectAllScoped(kept);
  expect(await bodyDisplay(page)).toBe("block");
  expect(requested.filter((path) => path !== "/control")).toEqual([]);
});

test("a DOCX with a crafted font name puts no rule on the page", async ({
  mount,
  page,
}) => {
  await mount(
    <div>
      <DocxHarness fixture="hostileFont" />
      <p className="z" data-probe-z="">
        z
      </p>
    </div>
  );
  await waitForDocumentLoad(page);
  await expect(pages(page)).toContainText("Hello World.");

  const docx = annotatorRoot(page).locator("[data-rca-docx]");
  await expectAllScoped(docx);
  expect(
    await page.evaluate(() => getComputedStyle(document.body).display)
  ).toBe("block");
  expect(
    await page
      .locator("[data-probe-z]")
      .evaluate((el) => getComputedStyle(el).display)
  ).toBe("block");
});

test("with showStructural on, scrollToAnnotation on a structural span that gave way resolves false at once", async ({
  mount,
  page,
}) => {
  const paragraph: Annotation = {
    id: "s-para",
    annotationLabel: { id: "label-2", text: "Paragraph" },
    json: { start: 0, end: 56 },
    structural: true,
  };
  await mount(
    <DocxHarness
      annotationIds={["d-1"]}
      extraAnnotations={[paragraph]}
      props={{ showStructural: true }}
    />
  );
  await waitForDocumentLoad(page);
  await expect(annotationParts(page, "d-1")).toHaveCount(1);
  await expect(annotationParts(page, "s-para")).toHaveCount(0);

  const elapsed = await page.evaluate(async () => {
    const started = performance.now();
    const result = await window.__rca?.scrollToAnnotation("s-para", {
      select: true,
    });
    return { result, ms: performance.now() - started };
  });
  expect(elapsed.result).toBe(false);
  expect(elapsed.ms).toBeLessThan(PROMPT_MS);
  // Never drawable, so not selected either.
  expect(await callHandle(page, "getSelectedAnnotationIds", [])).toEqual([]);
});

test("the scoper keeps @supports and @container rules, scoped, and they apply inside", async ({
  mount,
  page,
}) => {
  // The wrapper's control is fetched; nothing else is.
  const requested = await recordInvalidRequests(page);
  await mount(
    <ScopedSheet
      css={
        // The container queried is the host's (the wrapper): a document
        // cannot make one, `container-type` is not kept.
        "body { container-type: size; margin: 0 }" +
        " @supports (display: grid) { p { color: rgb(1, 2, 3) } }" +
        " @container (min-width: 1px) { p { background-color: rgb(4, 5, 6) } }"
      }
      scopeId="scoper-test"
    />
  );
  const scopeElement = page.locator('[data-rca-docx="scoper-test"]');
  await expectAllScoped(scopeElement);
  expect(
    await scopeElement.evaluate((el) => getComputedStyle(el).containerType)
  ).toBe("normal");
  const kinds = await scopeElement.evaluate((el) =>
    Array.from(
      el.querySelector("style")?.sheet?.cssRules ?? [],
      (rule) => rule.constructor.name
    )
  );
  expect(kinds).toEqual([
    "CSSStyleRule",
    "CSSSupportsRule",
    "CSSContainerRule",
  ]);

  const colours = (selector: string) =>
    page.locator(selector).evaluate((el) => {
      const style = getComputedStyle(el);
      return [style.color, style.backgroundColor];
    });
  expect(await colours('[data-rca-docx="scoper-test"] p')).toEqual([
    "rgb(1, 2, 3)",
    "rgb(4, 5, 6)",
  ]);
  // The `p` outside keeps its own.
  expect(await colours("[data-probe-z]")).not.toContain("rgb(1, 2, 3)");
  expect(await colours("[data-probe-z]")).not.toContain("rgb(4, 5, 6)");
  expect(requested.filter((path) => path !== "/control")).toEqual([]);
});

/** A box of the host's, away from the annotator. */
const OVERLAY_PROBE_STYLE = {
  position: "absolute",
  left: 1000,
  top: 100,
  width: 100,
  height: 100,
} as const;

/** Whether the host's box is what stands at its own centre. */
function overlayProbeIsOnTop(page: Page): Promise<boolean> {
  return page.locator("[data-probe-overlay]").evaluate((probe) => {
    const { left, top, width, height } = probe.getBoundingClientRect();
    return (
      document.elementFromPoint(left + width / 2, top + height / 2) === probe
    );
  });
}

test("a document styled to cover the whole page stays inside its viewer", async ({
  mount,
  page,
}) => {
  await mount(
    <div>
      <DocxHarness fixture="hostileOverlay" />
      <div data-probe-overlay="" style={OVERLAY_PROBE_STYLE} />
    </div>
  );
  await waitForDocumentLoad(page);
  const docx = annotatorRoot(page).locator("[data-rca-docx]");
  await expectAllScoped(docx);
  // Of the document's rule for its own element, `position: fixed` is not
  // kept; the rest is (the highest z-index, the red background)...
  expect(
    await docx.evaluate((el) => {
      const style = getComputedStyle(el);
      return [style.position, style.zIndex, style.backgroundColor];
    })
  ).toEqual(["static", "2147483647", "rgb(255, 0, 0)"]);
  // ...and it covers nothing of the host's: the probe is what is there.
  expect(await overlayProbeIsOnTop(page)).toBe(true);
});

test("the frame keeps a scope element fixed over the page inside the viewer", async ({
  mount,
  page,
}) => {
  await mount(
    <div>
      <DocxHarness />
      <div data-probe-overlay="" style={OVERLAY_PROBE_STYLE} />
    </div>
  );
  await waitForDocumentLoad(page);
  // What the allow-list keeps out of a document's stylesheet, put there by
  // the test: the frame alone has to contain it.
  await page.addStyleTag({
    content:
      "[data-rca-docx] { position: fixed !important; inset: 0 !important;" +
      " z-index: 2147483647 !important; background: red !important }",
  });
  const docx = annotatorRoot(page).locator("[data-rca-docx]");
  expect(
    await docx.evaluate((el) => {
      const style = getComputedStyle(el);
      return [style.position, style.zIndex];
    })
  ).toEqual(["fixed", "2147483647"]);
  expect(await overlayProbeIsOnTop(page)).toBe(true);
});

test("document CSS and inline styles fetch nothing", async ({
  mount,
  page,
}) => {
  const requested = await recordInvalidRequests(page);
  await mount(
    <IsolatedHtml
      html={
        "<style>" +
        "@import url(https://example.invalid/import.css);" +
        " @font-face { font-family: leak; src: url(https://example.invalid/font.woff2) }" +
        ' [data-annotation-id="d-1"] { background: url(https://example.invalid/leak) }' +
        ' p { background-image: url("https://example.invalid/leak2"); font-family: leak }' +
        "</style>" +
        '<span data-annotation-id="d-1" style="background:url(https://example.invalid/x)">x</span>' +
        "<p>p</p>"
      }
    />
  );
  // The control outside, fetched as usual, shows the interception works.
  await expectOnlyControlRequested(page, requested);
});

/** A GIF of one transparent pixel, as a data: URL (no request). */
const PIXEL = "data:image/gif;base64,R0lGODlhAQABAAAAACw=";

test("document HTML fetches nothing: no remote image source, media, form, SVG, MathML, background or popover", async ({
  mount,
  page,
}) => {
  const requested = await recordInvalidRequests(page);
  const X = "https://example.invalid";
  await mount(
    <IsolatedHtml
      html={
        `<p data-case="img"><img src="${X}/img" alt="a"></p>` +
        `<p data-case="srcset"><img src="${PIXEL}" srcset="${X}/srcset 2x"></p>` +
        `<picture><source srcset="${X}/source"><img src="${PIXEL}"></picture>` +
        `<table background="${X}/table"><tbody><tr><td background="${X}/td">x</td></tr></tbody></table>` +
        `<video poster="${X}/poster" src="${X}/video" autoplay muted></video>` +
        `<audio autoplay src="${X}/audio"></audio>` +
        `<input type="image" src="${X}/input">` +
        `<form action="${X}/form"><button formaction="${X}/formaction">b</button></form>` +
        `<svg width="10" height="10"><image href="${X}/svg-image" width="10" height="10"></image>` +
        `<rect width="10" height="10" fill="url(${X}/fill#x)"></rect></svg>` +
        "<math><mi>x</mi></math>" +
        '<div popover="manual" id="pop">popover</div><button popovertarget="pop">open</button>' +
        `<object data="${X}/object"></object><embed src="${X}/embed"><iframe src="${X}/iframe"></iframe>` +
        `<link rel="stylesheet" href="${X}/link.css"><link rel="preload" as="image" href="${X}/preload">` +
        `<img src="${PIXEL}" alt="kept">`
      }
    />
  );
  const scopeElement = page.locator("[data-rca-docx]");
  await expect(scopeElement.locator('img[alt="kept"]')).toHaveCount(1);
  // Nothing that could fetch, or open above the page, is left.
  await expect(
    scopeElement.locator(
      "svg, math, video, audio, source, picture, input, form, button, object, embed, iframe, link, [popover], [srcset], [background]"
    )
  ).toHaveCount(0);
  expect(
    await scopeElement
      .locator("img")
      .evaluateAll((images) => images.map((img) => img.getAttribute("src")))
  ).toEqual([null, PIXEL, PIXEL, PIXEL]);
  await expectOnlyControlRequested(page, requested);
});

test("several style blocks are scoped as the one stylesheet inserted: an open url( does not swallow the next", async ({
  mount,
  page,
}) => {
  const requested = await recordInvalidRequests(page);
  await mount(
    <IsolatedHtml
      html={
        "<style>p { background-image: env(x, url(data:abc</style>" +
        '<style>p { content: ")) } body { display: none } x { " }</style>' +
        "<style>p { color: rgb(1, 2, 3) }</style>" +
        "<p>doc</p>"
      }
    />
  );
  const scopeElement = page.locator("[data-rca-docx]");
  await expect(scopeElement.locator("p")).toHaveText("doc");
  await expect(scopeElement).toHaveAttribute("data-css-rejected", "false");
  // One stylesheet, holding what the third block may say.
  await expect(scopeElement.locator("style")).toHaveCount(1);
  expect(
    await scopeElement.locator("p").evaluate((el) => getComputedStyle(el).color)
  ).toBe("rgb(1, 2, 3)");
  expect(await bodyDisplay(page)).toBe("block");
  await expectAllScoped(scopeElement);
  await expectOnlyControlRequested(page, requested);
});

test("inline styles keep allow-listed declarations only: no fetch and no fixed position through a substitution function", async ({
  mount,
  page,
}) => {
  const requested = await recordInvalidRequests(page);
  await mount(
    <IsolatedHtml
      html={
        '<p data-case="env" style="background-image: env(nope, u\\72l(https://example.invalid/inl1))">a</p>' +
        '<p data-case="var" style="position: var(--n, fixed); top: 0">b</p>' +
        '<p data-case="sticky" style="position: env(nope, sticky); top: 0">c</p>' +
        '<p data-case="fixed" style="position: fixed; color: rgb(1, 2, 3)">d</p>' +
        '<p data-case="smuggled" style=\'color: env(x) "; background-image: u\\72l(https://example.invalid/inl2); x: " !important; --z: 1\'>e</p>' +
        '<p data-case="anchor" style="anchor-name: --menu; width: 144pt">f</p>' +
        '<p data-case="absolute" style="position: absolute; left: 10px">g</p>'
      }
    />
  );
  const scopeElement = page.locator("[data-rca-docx]");
  await expect(scopeElement.locator("p")).toHaveCount(7);
  expect(
    await scopeElement
      .locator("p")
      .evaluateAll((elements) =>
        elements.map((el) => [
          el.getAttribute("data-case"),
          el.getAttribute("style"),
          getComputedStyle(el).position,
          getComputedStyle(el).backgroundImage,
        ])
      )
  ).toEqual([
    ["env", null, "static", "none"],
    ["var", "top: 0px;", "static", "none"],
    ["sticky", "top: 0px;", "static", "none"],
    ["fixed", "color: rgb(1, 2, 3);", "static", "none"],
    ["smuggled", null, "static", "none"],
    ["anchor", "width: 144pt;", "static", "none"],
    ["absolute", "position: absolute; left: 10px;", "absolute", "none"],
  ]);
  expect(await bodyDisplay(page)).toBe("block");
  await expectAllScoped(scopeElement);
  await expectOnlyControlRequested(page, requested);
});

test("a DOCX hiding background images in substitution functions fetches nothing", async ({
  mount,
  page,
}) => {
  const requested = await recordInvalidRequests(page);
  await mount(
    <div>
      <DocxHarness fixture="hostileFetch" annotationIds={["d-1", "d-2"]} />
      <div data-control="" style={CONTROL_STYLE} />
    </div>
  );
  await waitForDocumentLoad(page);
  await expect(pages(page)).toContainText("Hello World.");
  // What the document's second rule selects is there.
  await expect(annotationParts(page, "d-1")).toHaveCount(1);
  await expect(annotationParts(page, "d-2")).toHaveCount(1);

  const docx = annotatorRoot(page).locator("[data-rca-docx]");
  await expectAllScoped(docx);
  expect(await bodyDisplay(page)).toBe("block");
  expect(
    await pages(page)
      .locator("p, [data-annotation-id]")
      .evaluateAll((elements) =>
        elements.map((el) => getComputedStyle(el).backgroundImage)
      )
  ).toEqual(["none", "none", "none", "none", "none"]);
  await expectOnlyControlRequested(page, requested);
});

test("a document's list items and counters do not renumber the host's list", async ({
  mount,
  page,
}) => {
  // The host's list shows each number as that many strokes, so the width of
  // an item tells its number: the second item's own number, and after the
  // third item's a counter of the host's own, `host`.
  const hostCss =
    '@counter-style rca-test-tally { system: additive; additive-symbols: 1 "|"; suffix: ""; }' +
    " [data-host-list] { counter-reset: list-item 0 host 1; }" +
    " [data-count] { list-style: rca-test-tally inside; font: 20px monospace; width: max-content; }" +
    ' [data-count="host"]::after { content: counter(host, rca-test-tally); }';
  await mount(
    <div>
      <style>{hostCss}</style>
      <ol data-host-list="reference">
        <li>
          <div />
        </li>
        <li data-count="list-item" />
        <li data-count="host" />
      </ol>
      <ol data-host-list="probe">
        <li>
          <DocxHarness fixture="hostileCounter" />
        </li>
        <li data-count="list-item" />
        <li data-count="host" />
      </ol>
    </div>
  );
  await waitForDocumentLoad(page);
  // The document's rule was kept, but for its `counter-increment`: its
  // paragraphs are list items.
  expect(
    await pages(page)
      .locator("p")
      .evaluateAll((elements) =>
        elements.map((el) => {
          const style = getComputedStyle(el);
          return [style.display, style.counterIncrement];
        })
      )
  ).toEqual([
    ["list-item", "none"],
    ["list-item", "none"],
    ["list-item", "none"],
  ]);
  const docx = annotatorRoot(page).locator("[data-rca-docx]");
  await expectAllScoped(docx);

  const widths = (list: string) =>
    page
      .locator(`[data-host-list="${list}"] [data-count]`)
      .evaluateAll((elements) =>
        elements.map((el) => el.getBoundingClientRect().width)
      );
  const reference = await widths("reference");
  // Item 2 shows two strokes; item 3 three, and one for `host` at 1.
  expect(reference[0]).toBeGreaterThan(0);
  expect(reference[1]).toBeCloseTo(2 * reference[0], 0);
  expect(await widths("probe")).toEqual(reference);
});

test("a stylesheet the browser reads back differently is dropped; the document and its annotations still render", async ({
  mount,
  page,
}) => {
  // A parser that does not read back what was written: every stylesheet
  // parsed outside the page that holds a scope selector (that is, the one
  // the format validates) is read with a rule more. The parsing itself is
  // Chromium's. (The development warning is checked in the unit tests: this
  // bundle is a production build, where it is silent.)
  await page.evaluate(() => {
    const textContent = Object.getOwnPropertyDescriptor(
      Node.prototype,
      "textContent"
    );
    Object.defineProperty(HTMLStyleElement.prototype, "textContent", {
      configurable: true,
      get(this: HTMLStyleElement) {
        return textContent?.get?.call(this) as string;
      },
      set(this: HTMLStyleElement, value: string) {
        const validated =
          this.ownerDocument !== document && value.includes("[data-rca-docx=");
        textContent?.set?.call(
          this,
          validated ? `${value}\nbody { display: none }` : value
        );
      },
    });
  });
  await mount(<DocxHarness annotationIds={["d-1", "d-2"]} />);
  await waitForDocumentLoad(page);

  await expect(pages(page)).toContainText("Hello World.");
  await expect(annotationParts(page, "d-1")).toHaveText(["Hello World"]);
  await expect(annotationParts(page, "d-2")).toHaveText(["Important Clause"]);
  const docx = annotatorRoot(page).locator("[data-rca-docx]");
  // The document's stylesheet is empty; the format's own is there.
  expect(
    await docx
      .locator("style")
      .evaluateAll((styles) => styles.map((style) => style.textContent ?? ""))
  ).toEqual(["", expect.stringContaining(".oc-annot-highlight")]);
  await expectAllScoped(docx);
  expect(await bodyDisplay(page)).toBe("block");
  // Without its stylesheet the paragraph has the page's font, not Cambria.
  expect(
    await pages(page)
      .locator("p")
      .first()
      .evaluate((el) => getComputedStyle(el).fontFamily)
  ).not.toContain("Cambria");
});

/** A laid-out link of the hyperlink fixture, by its text. */
function documentLink(page: Page, text: string): Locator {
  return pages(page).locator("a", { hasText: text });
}

test("a click on a link in the document never navigates the page: onOpenLink gets its URL with source native", async ({
  mount,
  page,
}) => {
  const requested = await recordInvalidRequests(page);
  await mount(<DocxHarness fixture="hyperlink" />);
  await waitForDocumentLoad(page);
  const url = page.url();
  // Every link opens in a new tab, with neither opener nor referrer.
  expect(
    await pages(page)
      .locator("a[href]")
      .evaluateAll((links) =>
        links.map((link) => [
          link.getAttribute("target"),
          link.getAttribute("rel"),
        ])
      )
  ).toEqual(Array(4).fill(["_blank", "noopener noreferrer"]));

  await clickOn(documentLink(page, "example site"));
  await clickOn(documentLink(page, "relative page"));
  await clickOn(documentLink(page, "write to us"), { toggle: true });

  expect(page.url()).toBe(url);
  expect(await harnessEvents(page, "onOpenLink")).toEqual([
    ["onOpenLink", "https://example.invalid/docx-link", "native"],
    ["onOpenLink", "docx-relative.html", "native"],
    ["onOpenLink", "mailto:legal@example.invalid", "native"],
  ]);
  expect(requested).toEqual([]);
  // The click was the link's: no annotation selection changed.
  expect(await harnessEvents(page, "onSelectionChange")).toEqual([]);
});

test("without onOpenLink, an https link opens in a new tab and a relative one does nothing", async ({
  mount,
  page,
}) => {
  await page.context().route("**/example.invalid/**", (route) =>
    route.fulfill({ status: 200, contentType: "text/html", body: "opened" })
  );
  await mount(<DocxHarness fixture="hyperlink" omitCallbacks={["onOpenLink"]} />);
  await waitForDocumentLoad(page);
  const url = page.url();

  const opened = page.context().waitForEvent("page");
  await clickOn(documentLink(page, "example site"));
  const tab = await opened;
  await tab.waitForLoadState();
  expect(tab.url()).toBe("https://example.invalid/docx-link");
  // No opener: the new tab cannot reach the annotator's page.
  expect(await tab.evaluate(() => window.opener)).toBeNull();
  await tab.close();

  const pagesBefore = page.context().pages().length;
  await clickOn(documentLink(page, "relative page"));
  expect(page.context().pages()).toHaveLength(pagesBefore);
  expect(page.url()).toBe(url);
});

test("a link to a bookmark scrolls the viewer to it and leaves the page's URL alone", async ({
  mount,
  page,
}) => {
  await mount(
    <DocxHarness fixture="hyperlink" props={{ defaultZoom: TALL_ZOOM }} />
  );
  await waitForDocumentLoad(page);
  const url = page.url();
  const bookmark = pages(page).locator('[id$="-Definitions"]');
  await expect(bookmark).toHaveCount(1);
  const before = await scrollTop(page);

  await clickOn(documentLink(page, "definitions"));
  await settledScrollTop(annotatorRoot(page));

  expect(page.url()).toBe(url);
  expect(await scrollTop(page)).toBeGreaterThan(before);
  const { top, bottom, viewHeight } = await inRootView(page, bookmark);
  expect(top).toBeGreaterThanOrEqual(0);
  expect(bottom).toBeLessThanOrEqual(viewHeight);
});

test("the view is as tall as its pages: pages that fit the viewer do not scroll it", async ({
  mount,
  page,
}) => {
  // Half-size landscape pages: well short of the viewer, and of the viewport.
  await mount(
    <DocxHarness fixture="landscape" props={{ defaultZoom: SMALL_ZOOM }} />
  );
  await waitForDocumentLoad(page);
  await expect(pageBoxes(page)).toHaveCount(1);
  const root = annotatorRoot(page);
  expect(
    await root.evaluate((el) => el.scrollHeight <= el.clientHeight)
  ).toBe(true);
});

/** The page-scale property docxodus declares and nothing reads. */
const PAGE_SCALE = "--rca-parity-page-scale: 1.00";
/**
 * What Chromium reads a `border` shorthand of docxodus' table rules as,
 * besides the borders: the border image at its initial values. The
 * allow-list drops border images (they can fetch); at these values they
 * draw nothing.
 */
const BORDER_IMAGE_INITIAL: readonly string[] = [
  "border-image-source: none",
  "border-image-slice: 100%",
  "border-image-width: 1",
  "border-image-outset: 0",
  "border-image-repeat: stretch",
];

for (const fixture of ["test", "landscape", "hyperlink", "features"]) {
  test(`parity: no element, attribute or declaration docxodus writes for ${fixture}.docx is dropped`, async ({
    mount,
    page,
  }) => {
    await mount(<DocxParity url={`/fixtures/docx/${fixture}.docx`} />);
    const text = await page.locator("[data-parity]").textContent();
    const report = JSON.parse(text ?? "") as ParityReport;

    expect(report.rejected).toBe(false);
    // The stylesheet docxodus wrote was read: its rules for the body, the
    // Normal style, the pagination elements and print.
    expect(report.emitted.length).toBeGreaterThan(80);
    expect(report.emitted).toContain(
      "line-height: calc(1lh * var(--docx-auto-line-spacing))"
    );
    expect(report.emitted).toContain("--docx-auto-line-spacing: 1.15");
    expect(report.emitted).toContain("white-space-collapse: preserve");
    expect(report.emitted).toContain("zoom: 1 !important");
    // Every declaration is written, in order, as it was read; but the
    // page-scale custom property, which docxodus declares and nothing reads,
    // and, for the document with a table, its border image's initial values.
    expect(report.emitted.filter((d) => d === PAGE_SCALE)).toHaveLength(1);
    const borderImage = report.emitted.filter((d) =>
      BORDER_IMAGE_INITIAL.includes(d)
    );
    expect(borderImage).toEqual(
      fixture === "features" ? BORDER_IMAGE_INITIAL : []
    );
    expect(report.written).toEqual(
      report.emitted.filter(
        (d) => d !== PAGE_SCALE && !BORDER_IMAGE_INITIAL.includes(d)
      )
    );
    // Of its rules, only @page (the whole page's) is not kept.
    expect(report.droppedRules).toEqual(["CSSPageRule"]);
    expect(report.inlineWritten).toEqual(report.inlineEmitted);

    // Every element docxodus wrote in the body is kept, in order.
    expect(report.elementsEmitted.length).toBeGreaterThan(0);
    expect(report.elementsWritten).toEqual(report.elementsEmitted);
    // And every attribute, but the ids of the pagination's staging and page
    // containers, which the isolation removes; it adds a target and a rel to
    // each link.
    expect(report.attributesLost).toEqual(["div[id]", "div[id]"]);
    expect(report.attributesAdded).toEqual(
      Array.from({ length: report.links }).flatMap(() => [
        "a[target]",
        "a[rel]",
      ])
    );
  });
}

test("parity: the features fixture has what the lists of the sanitiser were derived from", async ({
  mount,
  page,
}) => {
  await mount(<DocxParity url="/fixtures/docx/features.docx" />);
  const text = await page.locator("[data-parity]").textContent();
  const report = JSON.parse(text ?? "") as ParityReport;
  expect([...new Set(report.elementsEmitted)].sort()).toEqual(
    [
      "br", "col", "colgroup", "div", "h1", "h2", "img", "p", "span", "sub",
      "sup", "table", "tbody", "td", "tr",
    ].sort()
  );
});
