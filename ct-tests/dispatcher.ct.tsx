import { expect, test } from "@playwright/experimental-ct-react";
import type { Page } from "@playwright/test";

import { DispatcherHarness } from "./wrappers/DispatcherHarness";

import { setupDocxodusWasm } from "./helpers/docxodusWasm";
import { serveFixtures } from "./helpers/fixtures";
import { annotationBox, mountedPages } from "./helpers/geometry";
import {
  annotatorRoot,
  callHandle,
  harnessEvents,
  waitForDocumentLoad,
} from "./helpers/harness";

const ETON_PAGE_COUNT = 23;
/** A snippet of the DOCX fixture's text. */
const DOCX_SNIPPET = "sample DOCX document";

/** The viewers of the harness: PDF pages and the DOCX document. */
const PDF_PAGES = "[data-rca-page]";
const DOCX_DOCUMENT = "[data-rca-docx]";

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

/** What each `onDocumentLoad` the harness has seen reported. */
async function loadedPageCounts(page: Page): Promise<(number | null)[]> {
  const events = await harnessEvents(page, "onDocumentLoad");
  return events.map(([, info]) => (info as { pageCount: number | null }).pageCount);
}

test("document.format 'pdf' renders the PDF viewer and the ref handle works", async ({
  mount,
  page,
}) => {
  await mount(<DispatcherHarness format="pdf" />);
  await waitForDocumentLoad(page);
  const root = annotatorRoot(page);

  expect(await callHandle(page, "getPageCount", [])).toBe(ETON_PAGE_COUNT);
  await expect.poll(() => mountedPages(root)).toContain(0);
  await expect(page.locator(DOCX_DOCUMENT)).toHaveCount(0);

  await callHandle(page, "selectAnnotations", [["a-title"]]);
  expect(await callHandle(page, "getSelectedAnnotationIds", [])).toEqual([
    "a-title",
  ]);
  await expect(annotationBox(root, "a-title", 0)).toHaveAttribute(
    "data-selected",
    "true"
  );
});

test("document.format 'docx' renders the DOCX viewer", async ({
  mount,
  page,
}) => {
  await mount(<DispatcherHarness format="docx" />);
  await waitForDocumentLoad(page);

  await expect(page.locator(DOCX_DOCUMENT)).toBeVisible();
  await expect(page.locator(PDF_PAGES)).toHaveCount(0);
  expect(await callHandle(page, "getPageCount", [])).toBeNull();
  expect(await callHandle(page, "getText", [])).toContain(DOCX_SNIPPET);

  await callHandle(page, "selectAnnotations", [["d-1"]]);
  expect(await callHandle(page, "getSelectedAnnotationIds", [])).toEqual([
    "d-1",
  ]);
});

test("switching format remounts cleanly and clears selection", async ({
  mount,
  page,
}) => {
  const component = await mount(<DispatcherHarness format="pdf" />);
  await waitForDocumentLoad(page);
  await callHandle(page, "selectAnnotations", [["a-title"]]);
  expect(await callHandle(page, "getSelectedAnnotationIds", [])).toEqual([
    "a-title",
  ]);
  expect(await loadedPageCounts(page)).toEqual([ETON_PAGE_COUNT]);

  // PDF -> DOCX: the DOCX viewer is a fresh one, with nothing selected.
  await component.update(<DispatcherHarness format="docx" />);
  await expect(page.locator(DOCX_DOCUMENT)).toBeVisible();
  await expect.poll(() => loadedPageCounts(page)).toEqual([ETON_PAGE_COUNT, null]);
  await expect(page.locator(PDF_PAGES)).toHaveCount(0);
  expect(await callHandle(page, "getPageCount", [])).toBeNull();
  expect(await callHandle(page, "getText", [])).toContain(DOCX_SNIPPET);
  expect(await callHandle(page, "getSelectedAnnotationIds", [])).toEqual([]);

  // Select in DOCX, then back to PDF: again nothing carried over.
  await callHandle(page, "selectAnnotations", [["d-1"]]);
  expect(await callHandle(page, "getSelectedAnnotationIds", [])).toEqual([
    "d-1",
  ]);
  await component.update(<DispatcherHarness format="pdf" />);
  await expect
    .poll(() => loadedPageCounts(page))
    .toEqual([ETON_PAGE_COUNT, null, ETON_PAGE_COUNT]);
  await expect(page.locator(DOCX_DOCUMENT)).toHaveCount(0);
  await expect.poll(() => mountedPages(annotatorRoot(page))).toContain(0);
  expect(await callHandle(page, "getPageCount", [])).toBe(ETON_PAGE_COUNT);
  expect(await callHandle(page, "getSelectedAnnotationIds", [])).toEqual([]);
});
