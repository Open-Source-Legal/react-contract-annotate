/**
 * Which page a scroll target is drawn on first, and so whether it can be
 * drawn at all: the one answer the driver, the viewport and the pages share.
 */
import type { PDFPageProxy } from "pdfjs-dist/types/src/display/api";

import type {
  Annotation,
  Highlight,
  PawlsToken,
  SpanAnnotation,
  TokenAnnotation,
} from "../../core/index";
import { PDFPageInfo } from "../PDFPageInfo";
import { scrollTargetPage } from "../scrollTargetPage";
import { fakePage } from "./pdfjsFake";

const LABEL = Object.freeze({ id: "l", text: "Label" });
const BOX = Object.freeze({ left: 0, top: 0, right: 10, bottom: 10 });
const TOKEN: PawlsToken = { x: 10, y: 10, width: 20, height: 5, text: "Hello" };

/** `count` pages, each with one token. */
function pages(count: number): PDFPageInfo[] {
  return Array.from(
    { length: count },
    (_, i) =>
      new PDFPageInfo(fakePage(i + 1) as unknown as PDFPageProxy, [TOKEN], 1)
  );
}

function tokenAnnotation(id: string, ...onPages: number[]): TokenAnnotation {
  const json = Object.fromEntries(
    onPages.map((page) => [
      page,
      { bounds: BOX, tokensJsons: [], rawText: "" },
    ])
  );
  return {
    id,
    kind: "token",
    annotationLabel: LABEL,
    rawText: "",
    structural: false,
    approved: false,
    rejected: false,
    linkUrl: null,
    page: onPages[0],
    json,
    source: { id } as Annotation,
  };
}

const SPAN: SpanAnnotation = {
  id: "span",
  kind: "span",
  annotationLabel: LABEL,
  rawText: "",
  structural: false,
  approved: false,
  rejected: false,
  linkUrl: null,
  json: { start: 0, end: 1 },
  source: { id: "span" } as Annotation,
};

const annotations = [tokenAnnotation("a", 3, 1), tokenAnnotation("far", 9), SPAN];

function onTokens(id: string, tokensByPage: Record<number, number[]>): Highlight {
  return { id, target: { kind: "tokens", tokensByPage } };
}

const highlights: Highlight[] = [
  onTokens("t", { 4: [0], 2: [0] }),
  onTokens("beyond", { 9: [0] }),
  onTokens("missing-tokens", { 1: [5], 3: [0] }),
  { id: "b", target: { kind: "bounds", boundsByPage: { 5: BOX } } },
  {
    id: "tb",
    target: {
      kind: "tokens",
      tokensByPage: { 6: [9] },
      boundsByPage: { 6: BOX },
    },
  },
  {
    id: "bounds-elsewhere",
    target: {
      kind: "tokens",
      tokensByPage: { 5: [0] },
      boundsByPage: { 2: BOX },
    },
  },
  { id: "s", target: { kind: "span", start: 0, end: 3 } },
];

function pageOf(target: Parameters<typeof scrollTargetPage>[0]) {
  return scrollTargetPage(target, annotations, highlights, pages(8));
}

test("an annotation is scrolled to its first page", () => {
  expect(pageOf({ kind: "annotation", id: "a" })).toBe(1);
});

test("an annotation that is unknown, on a span or past the last page cannot be drawn", () => {
  expect(pageOf({ kind: "annotation", id: "nope" })).toBeNull();
  expect(pageOf({ kind: "annotation", id: "span" })).toBeNull();
  expect(pageOf({ kind: "annotation", id: "far" })).toBeNull();
});

test("a highlight is scrolled to the first page it is drawn on", () => {
  expect(pageOf({ kind: "highlight", id: "t" })).toBe(2);
  expect(pageOf({ kind: "highlight", id: "b" })).toBe(5);
});

test("a page whose tokens do not exist is not where a highlight is drawn", () => {
  // Page 1's token index 5 is not there; page 3's token is.
  expect(pageOf({ kind: "highlight", id: "missing-tokens" })).toBe(3);
});

test("given bounds draw a highlight whatever its tokens", () => {
  expect(pageOf({ kind: "highlight", id: "tb" })).toBe(6);
});

test("a page the highlight is only given bounds for counts as where it is drawn", () => {
  expect(pageOf({ kind: "highlight", id: "bounds-elsewhere" })).toBe(2);
});

test("a highlight that is unknown, on pages the document lacks, or a span cannot be drawn", () => {
  expect(pageOf({ kind: "highlight", id: "nope" })).toBeNull();
  expect(pageOf({ kind: "highlight", id: "beyond" })).toBeNull();
  expect(pageOf({ kind: "highlight", id: "s" })).toBeNull();
});

test("without pages nothing can be drawn", () => {
  expect(
    scrollTargetPage({ kind: "highlight", id: "t" }, annotations, highlights, [])
  ).toBeNull();
  expect(
    scrollTargetPage({ kind: "annotation", id: "a" }, annotations, highlights, [])
  ).toBeNull();
});
