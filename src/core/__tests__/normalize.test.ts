import rawAnnotations from "../../../fixtures/eton/annotations.json";
import {
  annotationPages,
  draftPages,
  normalizeAnnotation,
  normalizeAnnotations,
  type TokenAnnotation,
} from "../normalize";
import type { Annotation, MultipageAnnotationJson } from "../types";

// JSON inference widens `v: 2` and the bounds tuple, so the fixture is cast.
const anns = rawAnnotations as unknown as Annotation[];
const byId = (id: string) => anns.find((a) => a.id === id)!;

test("v1 token json is kept and typed as token", () => {
  const n = normalizeAnnotation(byId("a-title"));
  expect(n.kind).toBe("token");
  expect(annotationPages(n)).toEqual([0]);
});

test("v1 token json is passed through, not copied", () => {
  const a = byId("a-title");
  expect((normalizeAnnotation(a) as TokenAnnotation).json).toBe(a.json);
});

test("compact v2 json expands to v1", () => {
  const n = normalizeAnnotation(byId("a-compact")) as TokenAnnotation;
  expect(n.json[2].tokensJsons).toHaveLength(16);
  expect(n.json[2].tokensJsons[0]).toEqual({ pageIndex: 2, tokenIndex: 30 });
});

test("compact v2 expansion carries the annotation's rawText into each page", () => {
  const a = byId("a-compact");
  const n = normalizeAnnotation(a) as TokenAnnotation;
  expect(n.json[2].rawText).toBe(a.rawText);
});

test("multipage annotation reports both pages", () => {
  expect(annotationPages(normalizeAnnotation(byId("a-multi")))).toEqual([3, 4]);
});

test("page is the annotation's own page when given", () => {
  const n = normalizeAnnotation(byId("a-structural")) as TokenAnnotation;
  expect(n.page).toBe(1);
});

test("page falls back to the lowest page of the json", () => {
  const { page: _page, ...withoutPage } = byId("a-multi");
  const n = normalizeAnnotation(withoutPage) as TokenAnnotation;
  expect(n.page).toBe(3);
});

test("page falls back to 0 for a token annotation without pages", () => {
  const n = normalizeAnnotation({
    id: "e",
    annotationLabel: { id: "l", text: "L" },
    json: {},
  }) as TokenAnnotation;
  expect(n.kind).toBe("token");
  expect(n.page).toBe(0);
  expect(annotationPages(n)).toEqual([]);
});

test("a missing json is treated as an empty token annotation", () => {
  const n = normalizeAnnotation({
    id: "n",
    annotationLabel: { id: "l", text: "L" },
  } as unknown as Annotation) as TokenAnnotation;
  expect(n.kind).toBe("token");
  expect(n.json).toEqual({});
});

test("flags and link default to false / null and are carried through", () => {
  const plain = normalizeAnnotation(byId("a-title"));
  expect(plain).toMatchObject({
    structural: false,
    approved: false,
    rejected: false,
    linkUrl: null,
  });
  expect(normalizeAnnotation(byId("a-structural")).structural).toBe(true);
  expect(normalizeAnnotation(byId("a-link")).linkUrl).toBe(
    "https://example.com/terms"
  );
  const flagged = normalizeAnnotation({
    ...byId("a-title"),
    approved: true,
    rejected: true,
  });
  expect(flagged).toMatchObject({ approved: true, rejected: true });
});

test("rawText and label come from the source annotation", () => {
  const a = byId("a-title");
  const n = normalizeAnnotation(a);
  expect(n.rawText).toBe("Exhibit 10.1");
  expect(n.annotationLabel).toBe(a.annotationLabel);
  expect(n.id).toBe("a-title");
});

test("span json is typed as span", () => {
  const n = normalizeAnnotation({
    id: "s",
    annotationLabel: { id: "l", text: "L" },
    json: { start: 3, end: 9 },
  });
  expect(n).toMatchObject({
    kind: "span",
    structural: false,
    approved: false,
    rejected: false,
    linkUrl: null,
    rawText: "",
  });
  expect(annotationPages(n)).toEqual([]);
});

test("same input object returns the same normalised object", () => {
  const a = byId("a-title");
  expect(normalizeAnnotations([a])[0]).toBe(normalizeAnnotations([a])[0]);
});

test("normalizeAnnotations keeps the order and length of its input", () => {
  const list = [byId("a-multi"), byId("a-title"), byId("a-compact")];
  expect(normalizeAnnotations(list).map((n) => n.id)).toEqual([
    "a-multi",
    "a-title",
    "a-compact",
  ]);
});

test("source keeps the caller's object for callbacks", () => {
  const a = byId("a-title");
  expect(normalizeAnnotation(a).source).toBe(a);
});

test("draftPages lists the pages of multipage token json and none for a span", () => {
  const multi = byId("a-multi").json as MultipageAnnotationJson;
  expect(draftPages({ 4: multi[4], 3: multi[3] })).toEqual([3, 4]);
  expect(draftPages({ start: 2, end: 9 })).toEqual([]);
});
