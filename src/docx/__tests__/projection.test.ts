import { highlightColor } from "../../core/index";
import type {
  Annotation,
  AnnotationLabel,
  Highlight,
  InternalAnnotation,
  SpanAnnotation,
  TokenAnnotation,
} from "../../core/index";
import {
  ACTIVE_HIGHLIGHT_LABEL_ID,
  HIGHLIGHT_LABEL_ID,
  PENDING_COLOR,
  PENDING_ENTRY_ID,
  PENDING_LABEL_ID,
} from "../constants";
import {
  buildProjection,
  buildProjectionSet,
  isDrawableSpan,
  suppressedTargets,
  withoutIndentation,
} from "../projection";

const TEXT =
  "Hello World. This is a sample DOCX document for testing.\n" +
  "This paragraph contains an Important Clause that should be annotated.\n";

const CLAUSE: AnnotationLabel = {
  id: "label-1",
  text: "Important Clause",
  color: "#FF6B6B",
};
const DEFINITION: AnnotationLabel = { id: "label-2", text: "Definition" };

function span(
  id: string,
  start: number,
  end: number,
  {
    label = CLAUSE,
    structural = false,
    rawText = "",
  }: { label?: AnnotationLabel; structural?: boolean; rawText?: string } = {}
): SpanAnnotation {
  const source: Annotation = {
    id,
    annotationLabel: label,
    json: { start, end },
    structural,
  };
  return {
    kind: "span",
    id,
    annotationLabel: label,
    rawText,
    structural,
    approved: false,
    rejected: false,
    linkUrl: null,
    source,
    json: { start, end },
  };
}

const TOKEN: TokenAnnotation = {
  kind: "token",
  id: "t-1",
  annotationLabel: CLAUSE,
  rawText: "Hello",
  structural: false,
  approved: false,
  rejected: false,
  linkUrl: null,
  source: { id: "t-1", annotationLabel: CLAUSE, json: {} },
  page: 0,
  json: {
    0: {
      bounds: { top: 0, left: 0, right: 10, bottom: 10 },
      tokensJsons: [{ pageIndex: 0, tokenIndex: 0 }],
      rawText: "Hello",
    },
  },
};

function spanHighlight(id: string, start: number, end: number): Highlight {
  return { id, target: { kind: "span", start, end } };
}

type Input = {
  annotations?: InternalAnnotation[];
  highlights?: Highlight[];
  activeHighlightId?: string | null;
  pending?: { start: number; end: number } | null;
};

function input({
  annotations = [],
  highlights = [],
  activeHighlightId = null,
  pending = null,
}: Input) {
  return { text: TEXT, annotations, highlights, activeHighlightId, pending };
}

function project(options: Input = {}) {
  return buildProjectionSet(input(options));
}

const ids = (set: ReturnType<typeof project>) =>
  set.labelledText.map((entry) => entry.id);

test("span annotations become labelledText entries with start/end/text", () => {
  const set = project({
    annotations: [
      span("d-1", 0, 11),
      span("d-3", 84, 100, { label: DEFINITION, structural: true }),
    ],
  });

  expect(set.content).toBe(TEXT);
  expect(set.labelledText).toEqual([
    {
      id: "d-1",
      annotationLabel: "label-1",
      // Without a rawText of its own, anchored by the text its offsets name.
      rawText: "Hello World",
      page: 0,
      annotationJson: { start: 0, end: 11, text: "Hello World" },
      annotationType: "text",
      structural: false,
    },
    {
      id: "d-3",
      annotationLabel: "label-2",
      rawText: "Important Clause",
      page: 0,
      annotationJson: { start: 84, end: 100, text: "Important Clause" },
      annotationType: "structural",
      // docxodus would skip it: the display filters already let it through.
      structural: false,
    },
  ]);
  // Each label once, coloured like the PDF format colours it (grey without
  // a colour of its own).
  expect(set.textLabels).toEqual({
    "label-1": {
      id: "label-1",
      text: "Important Clause",
      color: "#FF6B6B",
      description: "",
      icon: "",
      labelType: "text",
    },
    "label-2": {
      id: "label-2",
      text: "Definition",
      color: "#616a6b",
      description: "",
      icon: "",
      labelType: "text",
    },
  });
});

test("span highlights become synthetic entries; the active one uses the selected synthetic label", () => {
  const set = project({
    annotations: [span("d-1", 0, 11)],
    highlights: [spanHighlight("h-1", 13, 17), spanHighlight("h-2", 30, 34)],
    activeHighlightId: "h-2",
  });

  expect(set.labelledText.slice(1)).toEqual([
    {
      id: "h-1",
      annotationLabel: HIGHLIGHT_LABEL_ID,
      rawText: "This",
      page: 0,
      annotationJson: { start: 13, end: 17, text: "This" },
      annotationType: "text",
      structural: false,
    },
    {
      id: "h-2",
      annotationLabel: ACTIVE_HIGHLIGHT_LABEL_ID,
      rawText: "DOCX",
      page: 0,
      annotationJson: { start: 30, end: 34, text: "DOCX" },
      annotationType: "text",
      structural: false,
    },
  ]);
  // A synthetic label takes its first highlight's colour (here the default);
  // each highlight's own colour is the generated CSS's.
  expect(set.textLabels[HIGHLIGHT_LABEL_ID]).toMatchObject({
    text: "",
    color: highlightColor(spanHighlight("h-1", 13, 17)),
  });
  expect(set.textLabels[ACTIVE_HIGHLIGHT_LABEL_ID]).toMatchObject({
    text: "",
    color: highlightColor(spanHighlight("h-2", 30, 34)),
  });
});

test("the anchor text is the host's rawText when it has one", () => {
  const set = project({
    annotations: [span("d-1", 0, 11, { rawText: "Hello World!" })],
  });
  // As in OpenContracts: docxodus validates and anchors by this text.
  expect(set.labelledText[0]).toMatchObject({
    rawText: "Hello World!",
    annotationJson: { start: 0, end: 11, text: "Hello World!" },
  });
});

test("without a rawText the anchor text is the slice its offsets name", () => {
  const set = project({ annotations: [span("d-1", 0, 11, { rawText: "" })] });
  expect(set.labelledText[0]).toMatchObject({
    rawText: "Hello World",
    annotationJson: { start: 0, end: 11, text: "Hello World" },
  });
});

test("token annotations and token/bounds highlights are dropped", () => {
  const set = project({
    annotations: [TOKEN, span("d-1", 0, 11)],
    highlights: [
      {
        id: "h-tokens",
        target: { kind: "tokens", tokensByPage: { 0: [1, 2] } },
      },
      {
        id: "h-bounds",
        target: {
          kind: "bounds",
          boundsByPage: { 0: { top: 0, left: 0, right: 5, bottom: 5 } },
        },
      },
      spanHighlight("h-span", 13, 17),
    ],
  });

  expect(ids(set)).toEqual(["d-1", "h-span"]);
});

test("an annotation whose offsets fall outside the text is dropped", () => {
  const set = project({
    annotations: [
      span("d-bad-span", 10_000_000, 10_000_010),
      span("past-the-end", 120, TEXT.length + 1),
      span("negative", -1, 4),
      span("d-1", 0, 11),
      span("to-the-end", 120, TEXT.length),
    ],
    highlights: [spanHighlight("h-bad", 10_000_000, 10_000_010)],
  });

  expect(ids(set)).toEqual(["d-1", "to-the-end"]);
});

test("start >= end is dropped", () => {
  const set = project({
    annotations: [span("empty", 5, 5), span("reversed", 11, 0)],
    highlights: [spanHighlight("h-empty", 7, 7)],
    pending: { start: 9, end: 3 },
  });

  expect(set.labelledText).toEqual([]);
  expect(set.textLabels).toEqual({});
});

test("a pending selection is projected last, as the synthetic pending entry", () => {
  const set = project({
    annotations: [span("d-1", 0, 11)],
    pending: { start: 13, end: 17 },
  });

  expect(set.labelledText.at(-1)).toEqual({
    id: PENDING_ENTRY_ID,
    annotationLabel: PENDING_LABEL_ID,
    rawText: "This",
    page: 0,
    annotationJson: { start: 13, end: 17, text: "This" },
    annotationType: "text",
    structural: false,
  });
  expect(set.textLabels[PENDING_LABEL_ID]).toMatchObject({
    text: "",
    color: PENDING_COLOR,
  });
});

test("the set is deterministic: equal input projects to an equal set", () => {
  const input = () =>
    project({
      annotations: [span("d-1", 0, 11)],
      highlights: [spanHighlight("h-1", 13, 17)],
    });
  expect(JSON.stringify(input())).toBe(JSON.stringify(input()));
});

test("isDrawableSpan: integer offsets with 0 <= start < end <= text length", () => {
  expect(isDrawableSpan({ start: 0, end: 1 }, "ab")).toBe(true);
  expect(isDrawableSpan({ start: 0, end: 2 }, "ab")).toBe(true);
  expect(isDrawableSpan({ start: 0, end: 3 }, "ab")).toBe(false);
  expect(isDrawableSpan({ start: 1, end: 1 }, "ab")).toBe(false);
  expect(isDrawableSpan({ start: -1, end: 1 }, "ab")).toBe(false);
  expect(isDrawableSpan({ start: 0.5, end: 1 }, "ab")).toBe(false);
  expect(isDrawableSpan({ start: Number.NaN, end: 1 }, "ab")).toBe(false);
});

test("withoutIndentation drops only the whitespace docxodus indents projected HTML with", () => {
  // As docxodus 12.4.1 returns a projection: the annotation starts the run.
  const projected =
    '<p class="docx-Normal">\n' +
    '          <span class="docx-DefaultParagraphFont">\n' +
    '            <span data-annotation-id="d-1">Hello World</span>. This is</span>\n' +
    "        </p>";
  expect(withoutIndentation(projected)).toBe(
    '<p class="docx-Normal"><span class="docx-DefaultParagraphFont">' +
      '<span data-annotation-id="d-1">Hello World</span>. This is</span></p>'
  );
  // Text, and spaces between elements on one line, are the document's.
  const text = "<span>a</span> <span>b</span><span>line\n  two</span>";
  expect(withoutIndentation(text)).toBe(text);
});

describe("overlap rule: structural spans give way", () => {
  // The first paragraph, [0, 56), as a structural annotation.
  const paragraph = () => span("s-para", 0, 56, { structural: true });

  test("to an annotation sharing its start", () => {
    const set = project({ annotations: [paragraph(), span("d-1", 0, 11)] });
    expect(ids(set)).toEqual(["d-1"]);
  });

  test("to a highlight sharing its end", () => {
    const set = project({
      annotations: [paragraph()],
      highlights: [spanHighlight("h-1", 44, 56)],
    });
    expect(ids(set)).toEqual(["h-1"]);
  });

  test("to the pending selection overlapping it partly", () => {
    const set = project({
      annotations: [span("s-part", 10, 30, { structural: true })],
      pending: { start: 20, end: 40 },
    });
    expect(ids(set)).toEqual([PENDING_ENTRY_ID]);
  });

  test("to an annotation strictly inside it: docxodus draws only one of two nested spans", () => {
    const set = project({ annotations: [paragraph(), span("d-in", 23, 29)] });
    expect(ids(set)).toEqual(["d-in"]);
  });

  test("not to spans it only touches, nor to other structural spans", () => {
    const set = project({
      annotations: [
        span("s-1", 0, 11, { structural: true }),
        span("d-after", 11, 20),
        span("s-2", 5, 30, { structural: true }),
      ],
    });
    // s-2 overlaps d-after and gives way; s-1 only touches it and stays,
    // and s-1 / s-2 overlapping each other is the engine's to decide.
    expect(ids(set)).toEqual(["s-1", "d-after"]);
  });

  test("overlapping non-structural spans are all projected: the engine decides", () => {
    const set = project({
      annotations: [span("d-1", 0, 11), span("d-over", 5, 20)],
      highlights: [spanHighlight("h-1", 8, 15)],
    });
    expect(ids(set)).toEqual(["d-1", "d-over", "h-1"]);
  });
});

test("suppressedTargets: entries the laid-out document has no element for, by kind", () => {
  const projection = buildProjection(
    input({
      annotations: [span("d-1", 0, 11), span("same", 5, 20)],
      highlights: [
        spanHighlight("same", 30, 34),
        spanHighlight("h-gone", 40, 44),
      ],
      pending: { start: 50, end: 54 },
    })
  );
  const suppressed = suppressedTargets(projection, [
    { id: "d-1", labelId: "label-1" },
    // A highlight's element does not stand for the annotation with its id.
    { id: "same", labelId: HIGHLIGHT_LABEL_ID },
  ]);
  expect([...suppressed.annotation]).toEqual(["same"]);
  expect([...suppressed.highlight]).toEqual(["h-gone"]);
});

test("a structural span that gave way is reported as not drawn", () => {
  const projection = buildProjection(
    input({
      annotations: [
        span("s-para", 0, 56, { structural: true }),
        span("d-1", 0, 11),
        span("s-alone", 57, 126, { structural: true }),
      ],
    })
  );
  expect([...projection.gaveWay]).toEqual(["s-para"]);
  expect(projection.set.labelledText.map((entry) => entry.id)).toEqual([
    "d-1",
    "s-alone",
  ]);
  const suppressed = suppressedTargets(projection, [
    { id: "d-1", labelId: "label-1" },
    { id: "s-alone", labelId: "label-1" },
  ]);
  expect([...suppressed.annotation]).toEqual(["s-para"]);
});
