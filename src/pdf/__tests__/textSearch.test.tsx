/**
 * The token search index and the matching over it: what `getText()` returns
 * and what `findText()` turns into highlights.
 */
import type { PDFPageProxy } from "pdfjs-dist/types/src/display/api";

import type { PawlsToken } from "../../core/index";
import { PDFPageInfo } from "../PDFPageInfo";
import { buildSearchIndex, findTokenMatches } from "../textSearch";
import { fakePage } from "./pdfjsFake";

function token(text: string, x = 0): PawlsToken {
  return { x, y: 0, width: 10, height: 5, text };
}

/** One page per entry, each with a token per word. */
function pagesOf(...pageTexts: string[][]): PDFPageInfo[] {
  return pageTexts.map(
    (words, i) =>
      new PDFPageInfo(
        fakePage(i + 1) as unknown as PDFPageProxy,
        words.map((word, w) => token(word, w * 10)),
        1
      )
  );
}

const ETON = pagesOf(
  ["Exhibit", "10.1", "Certain", "information", "about", "the", "Exhibit"],
  ["CONFIDENTIAL", "1.3", "Applicable", "Law"]
);

test("index text is page token texts joined by single spaces", () => {
  expect(buildSearchIndex(ETON).text).toBe(
    "Exhibit 10.1 Certain information about the Exhibit " +
      "CONFIDENTIAL 1.3 Applicable Law"
  );
});

test("tokens without text and pages without tokens add nothing, not even a space", () => {
  const pages = [
    new PDFPageInfo(
      fakePage(1) as unknown as PDFPageProxy,
      [token("a"), token(""), { ...token(""), is_image: true }, token("b")],
      1
    ),
    new PDFPageInfo(fakePage(2) as unknown as PDFPageProxy, [], 1),
    new PDFPageInfo(
      fakePage(3) as unknown as PDFPageProxy,
      [{ ...token(""), text: undefined as unknown as string }, token("c")],
      1
    ),
  ];
  expect(buildSearchIndex(pages).text).toBe("a b c");
});

test("every character of a token maps to it; the separators map to nothing", () => {
  const { text, charToToken } = buildSearchIndex(ETON);
  const start = text.indexOf("10.1");

  for (let i = 0; i < 4; i++) {
    expect(charToToken[start + i]).toEqual({ pageIndex: 0, tokenIndex: 1 });
  }
  expect(charToToken[start - 1]).toBeUndefined();
  expect(charToToken[start + 4]).toBeUndefined();
  const second = text.indexOf("CONFIDENTIAL");
  expect(charToToken[second]).toEqual({ pageIndex: 1, tokenIndex: 0 });
  expect(charToToken[second - 1]).toBeUndefined();
});

test("an empty document has an empty index", () => {
  expect(buildSearchIndex([])).toEqual({ text: "", charToToken: {} });
});

test("findTokenMatches('Exhibit') on page-0 tokens returns tokensByPage {0:[0]} first", () => {
  const matches = findTokenMatches(buildSearchIndex(ETON), "Exhibit");

  expect(matches).toEqual([
    { id: "find-0", target: { kind: "tokens", tokensByPage: { 0: [0] } } },
    { id: "find-1", target: { kind: "tokens", tokensByPage: { 0: [6] } } },
  ]);
});

test("case-insensitive by default; caseSensitive:true narrows", () => {
  const index = buildSearchIndex(ETON);

  const ids = (query: string, caseSensitive?: boolean) =>
    findTokenMatches(index, query, { caseSensitive }).map(
      (h) => (h.target as { tokensByPage: Record<number, number[]> }).tokensByPage
    );

  expect(ids("confidential")).toEqual([{ 1: [0] }]);
  expect(ids("confidential", true)).toEqual([]);
  expect(ids("CONFIDENTIAL", true)).toEqual([{ 1: [0] }]);
  expect(ids("exhibit")).toHaveLength(2);
  expect(ids("exhibit", false)).toHaveLength(2);
  expect(ids("Exhibit", true)).toHaveLength(2);
  expect(ids("EXHIBIT", true)).toEqual([]);
});

test("a match spanning a page break yields tokens on both pages", () => {
  const pages = pagesOf(["The", "parties", "agree"], ["to", "the", "terms"]);

  const [match, ...rest] = findTokenMatches(
    buildSearchIndex(pages),
    "agree to the"
  );

  expect(rest).toEqual([]);
  expect(match.target).toEqual({
    kind: "tokens",
    tokensByPage: { 0: [2], 1: [0, 1] },
  });
});

test("empty or whitespace query returns []", () => {
  const index = buildSearchIndex(ETON);
  expect(findTokenMatches(index, "")).toEqual([]);
  expect(findTokenMatches(index, "   ")).toEqual([]);
  expect(findTokenMatches(index, "\n\t ")).toEqual([]);
});

test("a query is matched literally, not as a regular expression", () => {
  const index = buildSearchIndex(
    pagesOf(["10.1", "10x1", "(see", "[a]*", "c++"])
  );
  const hits = (query: string) =>
    findTokenMatches(index, query).map(
      (h) => (h.target as { tokensByPage: Record<number, number[]> }).tokensByPage
    );

  expect(hits("10.1")).toEqual([{ 0: [0] }]);
  expect(hits("(see")).toEqual([{ 0: [2] }]);
  expect(hits("(")).toEqual([{ 0: [2] }]);
  expect(hits("[a]*")).toEqual([{ 0: [3] }]);
  expect(hits("c++")).toEqual([{ 0: [4] }]);
  expect(hits(".*")).toEqual([]);
});

test("a match inside a token marks the whole token, once", () => {
  const pages = pagesOf(["Exhibit", "Agreement,", "Agreements"]);

  const matches = findTokenMatches(buildSearchIndex(pages), "xhibit");
  expect(matches.map((h) => h.target)).toEqual([
    { kind: "tokens", tokensByPage: { 0: [0] } },
  ]);

  // Two tokens, each marked once, in token order.
  const both = findTokenMatches(buildSearchIndex(pages), "agreement");
  expect(both.map((h) => h.target)).toEqual([
    { kind: "tokens", tokensByPage: { 0: [1] } },
    { kind: "tokens", tokensByPage: { 0: [2] } },
  ]);
});

test("a multi-token match lists each token once, ascending", () => {
  const [match] = findTokenMatches(buildSearchIndex(ETON), "10.1 certain info");
  expect(match.target).toEqual({
    kind: "tokens",
    tokensByPage: { 0: [1, 2, 3] },
  });
});

test("whitespace in a query is normalised to the single spaces of the index", () => {
  const index = buildSearchIndex(ETON);
  const expected = [
    { id: "find-0", target: { kind: "tokens", tokensByPage: { 0: [1, 2] } } },
  ];

  expect(findTokenMatches(index, "10.1 Certain")).toEqual(expected);
  expect(findTokenMatches(index, "  10.1   Certain\n")).toEqual(expected);
});

test("matches do not overlap and come in document order", () => {
  const index = buildSearchIndex(pagesOf(["aaaa"], ["aa"]));
  const targets = findTokenMatches(index, "aa").map((h) => h.target);

  // "aaaa aa": the first token holds two matches, the second token one.
  expect(targets).toEqual([
    { kind: "tokens", tokensByPage: { 0: [0] } },
    { kind: "tokens", tokensByPage: { 0: [0] } },
    { kind: "tokens", tokensByPage: { 1: [0] } },
  ]);
  expect(findTokenMatches(index, "aa").map((h) => h.id)).toEqual([
    "find-0",
    "find-1",
    "find-2",
  ]);
});

test("no match, no highlight", () => {
  expect(findTokenMatches(buildSearchIndex(ETON), "zebra")).toEqual([]);
});
