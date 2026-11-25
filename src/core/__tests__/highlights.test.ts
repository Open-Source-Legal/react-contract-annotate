import { highlightPages, isSpanHighlight } from "../highlights";
import type { Highlight } from "../types";

test("tokens highlight reports its pages in ascending order", () => {
  expect(
    highlightPages({
      id: "h",
      target: { kind: "tokens", tokensByPage: { 4: [1], 2: [0] } },
    })
  ).toEqual([2, 4]);
});

test("pages sort numerically, not lexically", () => {
  expect(
    highlightPages({
      id: "h",
      target: { kind: "tokens", tokensByPage: { 10: [1], 9: [0], 100: [2] } },
    })
  ).toEqual([9, 10, 100]);
});

test("keys that are not page indices are ignored", () => {
  const tokensByPage = { 3: [0], x: [1], "-1": [2], "1.5": [3] };
  expect(
    highlightPages({
      id: "h",
      target: {
        kind: "tokens",
        tokensByPage: tokensByPage as unknown as Record<number, number[]>,
      },
    })
  ).toEqual([3]);
});

test("bounds highlight reports its pages", () => {
  const box = { top: 0, left: 0, right: 1, bottom: 1 };
  expect(
    highlightPages({
      id: "h",
      target: { kind: "bounds", boundsByPage: { 7: box } },
    })
  ).toEqual([7]);
});

test("span highlight has no pages", () => {
  expect(
    highlightPages({ id: "h", target: { kind: "span", start: 1, end: 4 } })
  ).toEqual([]);
});

test("isSpanHighlight is true only for span targets", () => {
  const box = { top: 0, left: 0, right: 1, bottom: 1 };
  const span: Highlight = {
    id: "s",
    target: { kind: "span", start: 0, end: 2 },
  };
  const tokens: Highlight = {
    id: "t",
    target: { kind: "tokens", tokensByPage: { 0: [0] } },
  };
  const bounds: Highlight = {
    id: "b",
    target: { kind: "bounds", boundsByPage: { 0: box } },
  };
  expect(isSpanHighlight(span)).toBe(true);
  expect(isSpanHighlight(tokens)).toBe(false);
  expect(isSpanHighlight(bounds)).toBe(false);
});
