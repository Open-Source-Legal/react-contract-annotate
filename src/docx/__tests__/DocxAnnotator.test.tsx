import { act, fireEvent, render } from "@testing-library/react";
import { createRef, useEffect, useRef } from "react";
import type { MockInstance } from "vitest";

import type {
  Annotation,
  AnnotationLabel,
  AnnotatorHandle,
  DocxAnnotatorProps,
  Highlight,
} from "../../core/index";
import { DocxAnnotator } from "../index";
import type { DocxScope } from "../isolation";
import { fakeDocxodus, flushPromises } from "./docxodusFake";

/** When true, the check of a scoped stylesheet sees an extra rule. */
const parsing = vi.hoisted(() => ({ tamper: false }));

// jsdom parses style sheets only in its main document (see `jsdomCss.ts`).
vi.mock("../isolation", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../isolation")>();
  const { parseInJsdom } = await import("./jsdomCss");
  return {
    ...actual,
    isolateDocument: (html: string, scope: DocxScope) =>
      actual.isolateDocument(html, scope, (css) =>
        parseInJsdom(
          parsing.tamper && css.includes(scope.selector)
            ? `${css} body { display: none }`
            : css
        )
      ),
  };
});

vi.mock("docxodus", async () =>
  (await import("./docxodusFake")).docxodusModule()
);
vi.mock("docxodus/react", async () =>
  (await import("./docxodusFake")).docxodusReactModule()
);

const TEXT =
  "Hello World. This is a sample DOCX document for testing.\n" +
  "This paragraph contains an Important Clause that should be annotated.\n";
const DATA = new Uint8Array([80, 75]);
const LABEL: AnnotationLabel = {
  id: "label-1",
  text: "Clause",
  color: "#FF6B6B",
};

function span(
  id: string,
  start: number,
  end: number,
  extra: Partial<Annotation> = {}
): Annotation {
  return { id, annotationLabel: LABEL, json: { start, end }, ...extra };
}

/** The laid-out pages: the annotator's own page container. */
const PAGES = '[data-rca-docx] [class$="-page-container"]';

const D1 = span("d-1", 0, 11);
const D2 = span("d-2", 84, 100);
const STRUCTURAL = span("d-3", 13, 17, { structural: true });
const BAD = span("d-bad-span", 10_000_000, 10_000_010);

let warn: MockInstance<typeof console.warn>;

beforeEach(() => {
  parsing.tamper = false;
  fakeDocxodus.reset();
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  warn.mockRestore();
});

type Props = Partial<DocxAnnotatorProps>;

function setup(props: Props = {}) {
  const handleRef = createRef<AnnotatorHandle>();
  const element = (next: Props) => (
    <DocxAnnotator
      ref={handleRef}
      source={{ data: DATA }}
      text={TEXT}
      wasmBaseUrl="/wasm/"
      annotations={[D1, D2]}
      {...next}
    />
  );
  const view = render(element(props));
  return {
    handle: () => {
      if (!handleRef.current) throw new Error("no handle");
      return handleRef.current;
    },
    rerender: (next: Props) => view.rerender(element({ ...props, ...next })),
    container: view.container,
  };
}

/** Lets the conversion finish and the document be projected and laid out. */
async function load(html = "<p>doc</p>") {
  await act(async () => {
    await flushPromises();
  });
  await act(async () => {
    fakeDocxodus.conversions.at(-1)?.resolve(html);
    await flushPromises();
  });
  await act(async () => {
    await flushPromises();
  });
}

/** Ids of the entries of the last projection. */
function projectedIds(): string[] {
  const calls = fakeDocxodus.projectAnnotationsOntoHtml.mock.calls;
  const set = calls.at(-1)?.[1];
  return set ? set.labelledText.map((entry) => entry.id ?? "") : [];
}

function warnings(): string[] {
  return warn.mock.calls.map(([message]) => String(message));
}

test("onDocumentLoad fires once the document is laid out, with pageCount null and the text", async () => {
  const onDocumentLoad = vi.fn();
  const { container } = setup({ onDocumentLoad });
  await act(async () => {
    await flushPromises();
  });
  expect(onDocumentLoad).not.toHaveBeenCalled();

  await load();
  expect(onDocumentLoad.mock.calls).toEqual([
    [{ pageCount: null, text: TEXT }],
  ]);
  expect(container.querySelector(PAGES)).not.toBeNull();
});

test("the handle: unpaginated, fit-width zoom 1, text and literal search", async () => {
  const { handle } = setup();
  await load();
  const h = handle();
  expect(h.getPageCount()).toBeNull();
  expect(h.getVisiblePageRange()).toBeNull();
  expect(h.scrollToPage(1)).toBe(false);
  expect(h.getZoom()).toBe(1);
  expect(h.getText()).toBe(TEXT);
  expect(h.findText("this")).toEqual([
    { id: "find-0", target: { kind: "span", start: 13, end: 17 } },
    { id: "find-1", target: { kind: "span", start: 57, end: 61 } },
  ]);
  expect(h.findText("this", { caseSensitive: true })).toEqual([]);
  expect(h.findText("")).toEqual([]);
  expect(h.findText("(.")).toEqual([]);
});

test("scrollToAnnotation / scrollToHighlight resolve false for what DOCX cannot draw", async () => {
  const token: Annotation = {
    id: "t-1",
    annotationLabel: LABEL,
    json: {
      0: {
        bounds: { top: 0, left: 0, right: 1, bottom: 1 },
        tokensJsons: [],
        rawText: "",
      },
    },
  };
  const tokens: Highlight = {
    id: "h-tokens",
    target: { kind: "tokens", tokensByPage: { 0: [1] } },
  };
  const outside: Highlight = {
    id: "h-outside",
    target: { kind: "span", start: 500, end: 510 },
  };
  const { handle } = setup({
    annotations: [D1, BAD, token],
    highlights: [tokens, outside],
  });
  // Not before the document is shown.
  await expect(handle().scrollToAnnotation("d-1")).resolves.toBe(false);
  await load();

  await expect(handle().scrollToAnnotation("d-bad-span")).resolves.toBe(false);
  await expect(handle().scrollToAnnotation("t-1")).resolves.toBe(false);
  await expect(handle().scrollToAnnotation("unknown")).resolves.toBe(false);
  await expect(handle().scrollToHighlight("h-tokens")).resolves.toBe(false);
  await expect(handle().scrollToHighlight("h-outside")).resolves.toBe(false);
});

test("visible span annotations are projected; a selection change that projects nothing new does not project again", async () => {
  // (Not scrolling: jsdom cannot.)
  const { rerender } = setup({
    annotations: [D1, D2, STRUCTURAL, BAD],
    scrollOnSelect: false,
  });
  await load();
  // The structural one is hidden by default and the bad span dropped.
  expect(projectedIds()).toEqual(["d-1", "d-2"]);
  const projections = fakeDocxodus.projectAnnotationsOntoHtml.mock.calls.length;

  rerender({ selectedAnnotationIds: ["d-1"] });
  await act(async () => {
    await flushPromises();
  });
  expect(fakeDocxodus.projectAnnotationsOntoHtml).toHaveBeenCalledTimes(
    projections
  );

  // Selecting the structural one forces it visible.
  rerender({ selectedAnnotationIds: ["d-3"] });
  await act(async () => {
    await flushPromises();
  });
  expect(projectedIds()).toEqual(["d-1", "d-2", "d-3"]);
});

test("unsupported inputs each warn once in development", async () => {
  const { rerender } = setup({
    annotations: [
      D1,
      span("approved", 0, 5, { approved: true }),
      span("rejected", 0, 5, { rejected: true }),
      span("link", 0, 5, { linkUrl: "https://example.com" }),
      {
        id: "t-1",
        annotationLabel: LABEL,
        json: { v: 2, p: { "0": { b: [0, 0, 1, 1], t: "0" } } },
      },
    ],
    highlights: [{ id: "h-b", target: { kind: "bounds", boundsByPage: {} } }],
    selectedRelationIds: ["r-1"],
    renderAnnotationActions: () => null,
  });
  await load();
  rerender({});
  await act(async () => {
    await flushPromises();
  });

  const messages = warnings();
  expect(messages).toHaveLength(6);
  expect(messages.some((m) => m.includes("renderAnnotationActions"))).toBe(
    true
  );
  expect(messages.some((m) => m.includes("SOURCE / TARGET"))).toBe(true);
  expect(messages.some((m) => m.includes("approved or rejected"))).toBe(true);
  expect(messages.some((m) => m.includes("linkUrl"))).toBe(true);
  expect(messages.some((m) => m.includes("token annotations"))).toBe(true);
  expect(messages.some((m) => m.includes('"tokens" or "bounds"'))).toBe(true);
});

test("supported inputs do not warn", async () => {
  setup({
    annotations: [D1, STRUCTURAL],
    highlights: [{ id: "h-1", target: { kind: "span", start: 0, end: 5 } }],
    selectedRelationIds: [],
  });
  await load();
  expect(warnings()).toEqual([]);
});

test("a load failure calls onError once and nothing is rendered", async () => {
  const onError = vi.fn();
  const { container } = setup({ onError });
  await act(async () => {
    await flushPromises();
  });
  const failure = new Error("not a docx");
  await act(async () => {
    fakeDocxodus.conversions[0].reject(failure);
    await flushPromises();
  });
  expect(onError.mock.calls).toEqual([[failure]]);
  expect(container.querySelector(PAGES)).toBeNull();
});

test("hovering an annotation reports it with the host's object; leaving reports null", async () => {
  const onAnnotationHover = vi.fn();
  const highlight: Highlight = {
    id: "h-1",
    target: { kind: "span", start: 13, end: 17 },
  };
  const { container } = setup({ onAnnotationHover, highlights: [highlight] });
  await load();
  const part = (id: string) =>
    container.querySelector(
      `${PAGES} [data-annotation-id="${id}"]`
    ) as HTMLElement;

  fireEvent.mouseOver(part("d-1"));
  fireEvent.mouseOver(part("d-1")); // still the same annotation
  fireEvent.mouseOver(part("h-1")); // a highlight is not an annotation
  fireEvent.mouseOver(part("d-2"));
  fireEvent.mouseLeave(
    container.querySelector("[data-rca-docx]") as HTMLElement
  );

  expect(onAnnotationHover.mock.calls).toEqual([[D1], [null], [D2], [null]]);
});

/** The selector of each style rule a browser parses out of `css`, at any depth. */
function parsedSelectors(css: string): string[] {
  const style = document.createElement("style");
  style.media = "not all"; // parsed, never applied
  style.textContent = css;
  document.head.append(style);
  try {
    const selectors: string[] = [];
    const walk = (rules: CSSRuleList) => {
      for (const rule of Array.from(rules)) {
        if ("selectorText" in rule) selectors.push(String(rule.selectorText));
        if ("cssRules" in rule) walk(rule.cssRules as CSSRuleList);
      }
    };
    walk(style.sheet?.cssRules ?? ([] as unknown as CSSRuleList));
    return selectors;
  } finally {
    style.remove();
  }
}

test("every stylesheet the annotator inserts is scoped to it, whatever the label ids and the document's CSS", async () => {
  const hostile: AnnotationLabel = {
    id: "x{}body{display:none}.y",
    text: "Hostile",
    color: "red;}body{display:none",
  };
  const { container } = setup({
    annotations: [span("d-1", 0, 11, { annotationLabel: hostile }), D2],
    selectedAnnotationIds: ["d-1"],
    scrollOnSelect: false,
  });
  await load(
    "<style>body { margin: 0 } span { white-space: pre-wrap } @page { margin: 0 }" +
      " @media print { body { margin: 0 } }</style><p>doc</p>"
  );

  const docx = container.querySelector("[data-rca-docx]") as HTMLElement;
  const scope = `[data-rca-docx="${docx.getAttribute("data-rca-docx")}"]`;
  const sheets = Array.from(container.querySelectorAll("style"));
  // The document's own stylesheet and the format's.
  expect(sheets).toHaveLength(2);
  for (const sheet of sheets) {
    const selectors = parsedSelectors(sheet.textContent ?? "");
    expect(selectors.length).toBeGreaterThan(0);
    for (const selector of selectors) {
      expect(selector.startsWith(scope)).toBe(true);
      expect(selector).not.toMatch(/(^|[\s,])body\b/);
    }
  }
  expect(fakeDocxodus.projectAnnotationsOntoHtml).toHaveBeenCalled();
});

test("an annotation the engine did not draw resolves scrollToAnnotation false at once", async () => {
  // d-over starts after d-1 and overlaps it: docxodus draws only d-1.
  const OVER = span("d-over", 5, 20);
  const { handle, container } = setup({ annotations: [D1, OVER] });
  await load();
  expect(
    container.querySelector(`${PAGES} [data-annotation-id="d-over"]`)
  ).toBeNull();

  const timedOut = new Promise((resolve) =>
    setTimeout(resolve, 200, "timeout")
  );
  await expect(
    Promise.race([
      handle().scrollToAnnotation("d-over", { select: true }),
      timedOut,
    ])
  ).resolves.toBe(false);
  // Not drawable, so not selected either.
  expect(handle().getSelectedAnnotationIds()).toEqual([]);
});

/**
 * A host that, from an effect of the commit that passes its first highlight,
 * jumps to it and activates it: `findText`, `highlights`, `scrollToHighlight`.
 */
function JumpingHost({
  highlights,
  onActiveHighlightChange,
  onJump,
}: {
  highlights: Highlight[];
  onActiveHighlightChange: (id: string | null) => void;
  onJump: (result: Promise<boolean>) => void;
}) {
  const handleRef = useRef<AnnotatorHandle>(null);
  const first = highlights[0]?.id;
  useEffect(() => {
    if (first) {
      onJump(handleRef.current!.scrollToHighlight(first, { activate: true }));
    }
  }, [first, onJump]);
  return (
    <DocxAnnotator
      ref={handleRef}
      source={{ data: DATA }}
      text={TEXT}
      wasmBaseUrl="/wasm/"
      annotations={[D1]}
      highlights={highlights}
      onActiveHighlightChange={onActiveHighlightChange}
    />
  );
}

test("a jump from an effect of the commit that supplies the highlight finds it", async () => {
  // jsdom lays nothing out and cannot scroll.
  const scrollIntoView = vi.fn();
  Element.prototype.scrollIntoView = scrollIntoView;
  const onActiveHighlightChange = vi.fn();
  const jumps: Promise<boolean>[] = [];
  const onJump = (result: Promise<boolean>) => jumps.push(result);
  const element = (highlights: Highlight[]) => (
    <JumpingHost
      highlights={highlights}
      onActiveHighlightChange={onActiveHighlightChange}
      onJump={onJump}
    />
  );
  const view = render(element([]));
  await load();

  view.rerender(
    element([{ id: "h-1", target: { kind: "span", start: 13, end: 17 } }])
  );

  expect(jumps).toHaveLength(1);
  // The target was known: the jump is under way rather than refused, and it
  // activated the highlight.
  const settled = await Promise.race([
    jumps[0].then((scrolled) => (scrolled ? "scrolled" : "refused")),
    flushPromises().then(() => "under way"),
  ]);
  expect(settled).not.toBe("refused");
  expect(onActiveHighlightChange.mock.calls).toEqual([["h-1"]]);
  view.unmount();
  delete (Element.prototype as Partial<Element>).scrollIntoView;
});

test("a document stylesheet that fails the check is dropped with one warning; annotations still render", async () => {
  parsing.tamper = true;
  const { container } = setup();
  await load("<style>p { color: red }</style><p>doc</p>");

  const docx = container.querySelector("[data-rca-docx]") as HTMLElement;
  const sheets = Array.from(
    docx.querySelectorAll("style"),
    (s) => s.textContent
  );
  // The document's stylesheet is empty; the format's own is there.
  expect(sheets).toHaveLength(2);
  expect(sheets[0]).toBe("");
  expect(sheets[1]).toContain(".oc-annot-highlight");
  expect(warnings().filter((m) => m.includes("stylesheet"))).toHaveLength(1);
  expect(
    container.querySelector(`${PAGES} [data-annotation-id="d-1"]`)
  ).not.toBeNull();
});
