import type {
  Annotation,
  AnnotationLabel,
  Highlight,
  InternalAnnotation,
  SpanAnnotation,
  TokenAnnotation,
} from "../../core/index";
import { TEXT_BLOCK_HIGHLIGHT_COLOR } from "../../core/index";
import {
  ACTIVE_HIGHLIGHT_LABEL_ID,
  HIGHLIGHT_LABEL_ID,
  PENDING_COLOR,
  PENDING_ENTRY_ID,
  PENDING_LABEL_ID,
} from "../constants";
import {
  buildProjectionSet,
  isDrawableSpan,
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
  }: { label?: AnnotationLabel; structural?: boolean } = {}
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
    rawText: "stale text the host kept",
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

function project({
  annotations = [] as InternalAnnotation[],
  highlights = [] as Highlight[],
  activeHighlightId = null as string | null,
  pending = null as { start: number; end: number } | null,
} = {}) {
  return buildProjectionSet({
    text: TEXT,
    annotations,
    highlights,
    activeHighlightId,
    pending,
  });
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
      // The text the offsets name, not the host's (possibly stale) rawText:
      // docxodus anchors the annotation by it.
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
  expect(set.textLabels[HIGHLIGHT_LABEL_ID]).toMatchObject({
    text: "",
    color: TEXT_BLOCK_HIGHLIGHT_COLOR,
  });
  expect(set.textLabels[ACTIVE_HIGHLIGHT_LABEL_ID]).toMatchObject({
    text: "",
    color: TEXT_BLOCK_HIGHLIGHT_COLOR,
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
