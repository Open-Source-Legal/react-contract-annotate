import { safeCssColor } from "../geometry/colorUtils";
import { fromOpenContractsExport } from "../fromOpenContractsExport";
import type {
  OpenContractAnnotationExport,
  OpenContractDocExport,
} from "../fromOpenContractsExport";
import type {
  CompactAnnotationJson,
  PawlsPage,
  SpanAnnotationJson,
} from "../types";

const PAWLS: PawlsPage[] = [
  {
    page: { width: 600, height: 800, index: 0 },
    tokens: [{ x: 1, y: 2, width: 3, height: 4, text: "Hello" }],
  },
];

const TOKEN_JSON = {
  0: {
    bounds: { top: 1, bottom: 2, left: 3, right: 4 },
    tokensJsons: [{ pageIndex: 0, tokenIndex: 0 }],
    rawText: "Hello",
  },
};

function annotation(
  overrides: Partial<OpenContractAnnotationExport> = {}
): OpenContractAnnotationExport {
  return {
    id: 7,
    annotationLabel: "Clause",
    rawText: "Hello",
    page: 0,
    annotation_json: TOKEN_JSON,
    structural: false,
    ...overrides,
  };
}

function docExport(
  overrides: Partial<OpenContractDocExport> = {}
): OpenContractDocExport {
  return {
    title: "Agreement",
    content: "Hello world",
    description: null,
    pawls_file_content: PAWLS,
    page_count: 1,
    doc_labels: [],
    labelled_text: [annotation()],
    ...overrides,
  };
}

test("labelled_text maps to Annotation with label objects from the lookup", () => {
  const { annotations } = fromOpenContractsExport(
    docExport({
      labelled_text: [
        annotation({ id: 1, annotationLabel: "Clause", structural: true }),
        annotation({ id: 2, annotationLabel: "Party" }),
      ],
    }),
    {
      Clause: {
        id: "42",
        text: "Clause",
        color: "#FF6B6B",
        description: "A clause",
        icon: "tag",
      },
      Party: { text: "Party", color: "#00AA00" },
    }
  );

  expect(annotations).toEqual([
    {
      id: "1",
      annotationLabel: {
        id: "42",
        text: "Clause",
        color: "#FF6B6B",
        description: "A clause",
        icon: "tag",
      },
      rawText: "Hello",
      page: 0,
      json: TOKEN_JSON,
      structural: true,
    },
    {
      id: "2",
      // An entry without an id is identified by the name it is keyed by.
      annotationLabel: { id: "Party", text: "Party", color: "#00AA00" },
      rawText: "Hello",
      page: 0,
      json: TOKEN_JSON,
      structural: false,
    },
  ]);
});

test("without a lookup, a label is synthesised: id === text === name and a stable colour for the same name", () => {
  const first = fromOpenContractsExport(
    docExport({
      labelled_text: [
        annotation({ id: 1, annotationLabel: "Clause" }),
        annotation({ id: 2, annotationLabel: "Party" }),
        annotation({ id: 3, annotationLabel: "Clause" }),
      ],
    })
  ).annotations;
  const [clause, party, clauseAgain] = first.map((a) => a.annotationLabel);

  expect(clause.id).toBe("Clause");
  expect(clause.text).toBe("Clause");
  expect(party.id).toBe("Party");
  expect(clause.color).toBeTruthy();
  // A colour the renderer accepts, not its fallback.
  expect(safeCssColor(clause.color, "fallback")).toBe(clause.color);
  expect(clauseAgain.color).toBe(clause.color);

  // Stable across calls.
  const second = fromOpenContractsExport(
    docExport({ labelled_text: [annotation({ annotationLabel: "Clause" })] })
  ).annotations;
  expect(second[0].annotationLabel.color).toBe(clause.color);
});

test("a label missing from a given lookup is synthesised too", () => {
  const { annotations } = fromOpenContractsExport(
    docExport({ labelled_text: [annotation({ annotationLabel: "Other" })] }),
    { Clause: { text: "Clause" } }
  );
  expect(annotations[0].annotationLabel).toMatchObject({
    id: "Other",
    text: "Other",
  });
  expect(annotations[0].annotationLabel.color).toBeTruthy();
});

test("annotation ids are stringified; missing ids get 'ann-<index>'", () => {
  const { annotations } = fromOpenContractsExport(
    docExport({
      labelled_text: [
        annotation({ id: 12 }),
        annotation({ id: null }),
        annotation({ id: "abc" }),
        annotation({ id: 0 }),
        annotation({ id: undefined }),
      ],
    })
  );
  expect(annotations.map((a) => a.id)).toEqual([
    "12",
    "ann-1",
    "abc",
    "0",
    "ann-4",
  ]);
});

test("token and span annotation_json pass through unchanged", () => {
  const compact: CompactAnnotationJson = {
    v: 2,
    p: { "0": { b: [1, 2, 3, 4], t: "0-2" } },
  };
  const span: SpanAnnotationJson & { text: string } = {
    start: 4,
    end: 9,
    text: "world",
  };
  const { annotations } = fromOpenContractsExport(
    docExport({
      labelled_text: [
        annotation({ id: 1, annotation_json: TOKEN_JSON }),
        annotation({ id: 2, annotation_json: compact }),
        annotation({ id: 3, annotation_json: span }),
      ],
    })
  );
  expect(annotations[0].json).toBe(TOKEN_JSON);
  expect(annotations[1].json).toBe(compact);
  expect(annotations[2].json).toBe(span);
});

test("relationships map to Relation with stringified ids", () => {
  const { relations } = fromOpenContractsExport(
    docExport({
      relationships: [
        {
          id: 5,
          relationshipLabel: "Refers to",
          source_annotation_ids: [1, "2"],
          target_annotation_ids: [3],
          structural: true,
        },
        {
          id: null,
          relationshipLabel: "Refers to",
          source_annotation_ids: [4],
          target_annotation_ids: [],
        },
      ],
    }),
    { "Refers to": { id: "9", text: "Refers to", color: "#123456" } }
  );

  expect(relations).toEqual([
    {
      id: "5",
      label: { id: "9", text: "Refers to", color: "#123456" },
      sourceIds: ["1", "2"],
      targetIds: ["3"],
      structural: true,
    },
    {
      id: "rel-1",
      label: { id: "9", text: "Refers to", color: "#123456" },
      sourceIds: ["4"],
      targetIds: [],
    },
  ]);
});

test("without relationships, relations is empty", () => {
  expect(fromOpenContractsExport(docExport()).relations).toEqual([]);
});

test("pawls_file_content -> pawls, content -> text", () => {
  const result = fromOpenContractsExport(docExport());
  expect(result.pawls).toBe(PAWLS);
  expect(result.text).toBe("Hello world");
});

test("link_url maps to linkUrl", () => {
  const { annotations } = fromOpenContractsExport(
    docExport({
      labelled_text: [
        annotation({ id: 1, link_url: "https://example.com/a" }),
        annotation({ id: 2, link_url: null }),
        annotation({ id: 3 }),
      ],
    })
  );
  expect(annotations[0].linkUrl).toBe("https://example.com/a");
  expect(annotations[1].linkUrl).toBeNull();
  expect(annotations[2]).not.toHaveProperty("linkUrl");
});

test("the same label name yields the same label object across annotations and relations", () => {
  const result = fromOpenContractsExport(
    docExport({
      labelled_text: [
        annotation({ id: 1, annotationLabel: "Clause" }),
        annotation({ id: 2, annotationLabel: "Clause" }),
      ],
      relationships: [
        {
          id: 1,
          relationshipLabel: "Clause",
          source_annotation_ids: [1],
          target_annotation_ids: [2],
        },
      ],
    })
  );
  expect(result.annotations[0].annotationLabel).toBe(
    result.annotations[1].annotationLabel
  );
  expect(result.relations[0].label).toBe(result.annotations[0].annotationLabel);
});
