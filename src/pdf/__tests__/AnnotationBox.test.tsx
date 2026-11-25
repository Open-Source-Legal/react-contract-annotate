/**
 * The PDF annotation box: its box, token highlights, label chip, relation
 * badge and click model, rendered inside a real `AnnotatorShell` whose
 * common props drive the display settings and selection.
 */
import { fireEvent, render } from "@testing-library/react";
import type { PDFPageProxy } from "pdfjs-dist/types/src/display/api";

import { AnnotatorShell, useVisibleAnnotations } from "../../core/index";
import type {
  Annotation,
  AnnotatorCommonProps,
  PawlsToken,
} from "../../core/index";
import { AnnotationBox } from "../AnnotationBox";
import { PDFPageInfo } from "../PDFPageInfo";
import { fakePage } from "./pdfjsFake";

const LABEL = Object.freeze({ id: "l1", text: "Clause", color: "#2563eb" });

const TOKENS: PawlsToken[] = [
  { x: 10, y: 10, width: 20, height: 5, text: "Hello" },
  { x: 35, y: 10, width: 20, height: 5, text: "world" },
];

const BOUNDS = Object.freeze({ top: 10, left: 10, right: 55, bottom: 15 });

function tokenAnnotation(
  id: string,
  overrides: Partial<Annotation> = {}
): Annotation {
  return {
    id,
    annotationLabel: LABEL,
    rawText: "Hello world",
    page: 0,
    json: {
      0: {
        bounds: BOUNDS,
        tokensJsons: [
          { pageIndex: 0, tokenIndex: 0 },
          { pageIndex: 0, tokenIndex: 1 },
        ],
        rawText: "Hello world",
      },
    },
    ...overrides,
  };
}

function pageInfo(scale = 1): PDFPageInfo {
  return new PDFPageInfo(
    fakePage(1) as unknown as PDFPageProxy,
    TOKENS,
    scale
  );
}

/** Draws a box for every visible token annotation, as a page does. */
function Boxes({ info }: { info: PDFPageInfo }) {
  const annotations = useVisibleAnnotations();
  return (
    <>
      {annotations.map((annotation) =>
        annotation.kind === "token" ? (
          <AnnotationBox
            key={annotation.id}
            annotation={annotation}
            pageInfo={info}
          />
        ) : null
      )}
    </>
  );
}

type Common = Partial<AnnotatorCommonProps> & { annotations: Annotation[] };

function renderBoxes(common: Common, info = pageInfo()) {
  const view = render(
    <AnnotatorShell common={common} handleRef={null}>
      <Boxes info={info} />
    </AnnotatorShell>
  );
  return {
    ...view,
    rerender: (next: Common) =>
      view.rerender(
        <AnnotatorShell common={next} handleRef={null}>
          <Boxes info={info} />
        </AnnotatorShell>
      ),
  };
}

function box(container: HTMLElement, id: string): HTMLElement | null {
  return container.querySelector<HTMLElement>(`[data-rca-annotation="${id}"]`);
}

function chip(container: HTMLElement, id: string): HTMLElement | null {
  return box(container, id)?.querySelector<HTMLElement>(
    "[data-rca-label-chip]"
  ) ?? null;
}

function tokenRects(container: HTMLElement, id: string): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(`[data-rca-token="${id}"]`)
  );
}

/** The text of the stylesheet rules that apply to `element`. */
function matchingCss(element: Element): string {
  let text = "";
  for (const sheet of Array.from(document.styleSheets)) {
    for (const rule of Array.from(sheet.cssRules)) {
      if (rule instanceof CSSStyleRule && element.matches(rule.selectorText)) {
        text += rule.cssText;
      }
    }
  }
  return text;
}

test("a token index past the end of the page is skipped; the remaining tokens still render", () => {
  const annotation = tokenAnnotation("a-bad-token", {
    json: {
      0: {
        bounds: BOUNDS,
        tokensJsons: [
          { pageIndex: 0, tokenIndex: 0 },
          { pageIndex: 0, tokenIndex: 999999 },
        ],
        rawText: "Hello",
      },
    },
  });
  const { container } = renderBoxes({ annotations: [annotation] });

  const rects = tokenRects(container, "a-bad-token");
  expect(rects).toHaveLength(1);
  const { left, top, width, height } = rects[0].style;
  // Token 0 (10, 10, 20 x 5) grown by one pixel on every side.
  expect({ left, top, width, height }).toEqual({
    left: "9px",
    top: "9px",
    width: "22px",
    height: "7px",
  });
  expect(box(container, "a-bad-token")).not.toBeNull();
});

test("an annotation page that has no bounds renders nothing for that page and does not throw", () => {
  const noBounds = tokenAnnotation("a-no-bounds", {
    json: {
      0: {
        tokensJsons: [{ pageIndex: 0, tokenIndex: 0 }],
        rawText: "Hello",
      },
    } as unknown as Annotation["json"],
  });
  const otherPage = tokenAnnotation("a-other-page", {
    page: 3,
    json: {
      3: { bounds: BOUNDS, tokensJsons: [], rawText: "" },
    },
  });

  const { container } = renderBoxes({
    annotations: [noBounds, otherPage, tokenAnnotation("a-ok")],
  });

  expect(box(container, "a-no-bounds")).toBeNull();
  expect(tokenRects(container, "a-no-bounds")).toHaveLength(0);
  expect(box(container, "a-other-page")).toBeNull();
  expect(box(container, "a-ok")).not.toBeNull();
});

test("labelDisplay 'hide' renders no chip; 'always' renders it; 'hover' renders it only while hovered or selected", () => {
  const annotations = [tokenAnnotation("a1")];
  const view = renderBoxes({ annotations, labelDisplay: "hide" });
  const { container } = view;
  fireEvent.mouseEnter(box(container, "a1")!);
  expect(chip(container, "a1")).toBeNull();

  view.rerender({ annotations, labelDisplay: "always" });
  fireEvent.mouseLeave(box(container, "a1")!);
  expect(chip(container, "a1")).not.toBeNull();

  view.rerender({ annotations, labelDisplay: "hover" });
  expect(chip(container, "a1")).toBeNull();
  fireEvent.mouseEnter(box(container, "a1")!);
  expect(chip(container, "a1")).not.toBeNull();
  fireEvent.mouseLeave(box(container, "a1")!);
  expect(chip(container, "a1")).toBeNull();

  view.rerender({
    annotations,
    labelDisplay: "hover",
    selectedAnnotationIds: ["a1"],
  });
  expect(chip(container, "a1")).not.toBeNull();
});

test("renderAnnotationActions output is inside the chip and receives {selected, hovered}", () => {
  const renderAnnotationActions = vi.fn(
    (a: Annotation, ctx: { selected: boolean; hovered: boolean }) => (
      <i data-actions-for={a.id}>
        {`${ctx.selected ? "selected" : "unselected"} ${
          ctx.hovered ? "hovered" : "not-hovered"
        }`}
      </i>
    )
  );
  const annotation = tokenAnnotation("a1");
  const { container } = renderBoxes({
    annotations: [annotation],
    labelDisplay: "always",
    defaultSelectedAnnotationIds: ["a1"],
    renderAnnotationActions,
  });

  const actions = chip(container, "a1")?.querySelector("[data-actions-for]");
  expect(actions?.getAttribute("data-actions-for")).toBe("a1");
  expect(actions?.textContent).toBe("selected not-hovered");
  // The host's own annotation object, not the normalised copy.
  expect(renderAnnotationActions.mock.calls.at(-1)?.[0]).toBe(annotation);

  fireEvent.mouseEnter(box(container, "a1")!);
  expect(
    chip(container, "a1")?.querySelector("[data-actions-for]")?.textContent
  ).toBe("selected hovered");
});

test("no slot: the chip contains only the label text", () => {
  const { container } = renderBoxes({
    annotations: [tokenAnnotation("a1")],
    labelDisplay: "always",
  });

  const labelChip = chip(container, "a1");
  expect(labelChip?.textContent).toBe("Clause");
  expect(labelChip?.querySelectorAll("*").length).toBeGreaterThan(0);
  expect(labelChip?.querySelector("button, a, input, svg")).toBeNull();
});

test("approved / rejected set data attributes and the ported border styling", () => {
  const { container } = renderBoxes({
    annotations: [
      tokenAnnotation("a-approved", { approved: true }),
      tokenAnnotation("a-rejected", { rejected: true }),
      tokenAnnotation("a-plain"),
    ],
  });
  const approved = box(container, "a-approved")!;
  const rejected = box(container, "a-rejected")!;
  const plain = box(container, "a-plain")!;

  expect(approved.dataset).toMatchObject({
    approved: "true",
    rejected: "false",
  });
  expect(rejected.dataset).toMatchObject({
    approved: "false",
    rejected: "true",
  });
  expect(plain.dataset).toMatchObject({ approved: "false", rejected: "false" });

  // APPROVED_RGB (46, 204, 113) and REJECTED_RGB (128, 0, 0) glows with
  // their pulse animations.
  expect(matchingCss(approved)).toMatch(/rgba\(46,\s*204,\s*113,\s*0\.18\)/);
  expect(matchingCss(approved)).toMatch(/animation/);
  expect(matchingCss(rejected)).toMatch(/rgba\(128,\s*0,\s*0,\s*0\.18\)/);
  expect(matchingCss(plain)).not.toMatch(/animation/);
});

test("selected relation endpoint shows SOURCE / TARGET badge", () => {
  const annotations = [
    tokenAnnotation("a-source"),
    tokenAnnotation("a-target"),
    tokenAnnotation("a-other"),
  ];
  const relations = [
    {
      id: "r1",
      label: { id: "l-ref", text: "References" },
      sourceIds: ["a-source"],
      targetIds: ["a-target"],
    },
  ];
  const badge = (container: HTMLElement, id: string) =>
    box(container, id)
      ?.querySelector("[data-rca-relation-role]")
      ?.getAttribute("data-rca-relation-role") ?? null;

  const view = renderBoxes({ annotations, relations });
  expect(badge(view.container, "a-source")).toBeNull();

  view.rerender({ annotations, relations, selectedRelationIds: ["r1"] });
  expect(badge(view.container, "a-source")).toBe("SOURCE");
  expect(badge(view.container, "a-target")).toBe("TARGET");
  expect(badge(view.container, "a-other")).toBeNull();
});

test("the label bar and the relation badge take their font and stacking from custom properties with the ported defaults", () => {
  renderBoxes({
    annotations: [tokenAnnotation("a-source"), tokenAnnotation("a-target")],
    relations: [
      {
        id: "r1",
        label: { id: "l-ref", text: "References" },
        sourceIds: ["a-source"],
        targetIds: ["a-target"],
      },
    ],
    selectedRelationIds: ["r1"],
  });

  const css = Array.from(document.styleSheets)
    .flatMap((sheet) => Array.from(sheet.cssRules, (rule) => rule.cssText))
    .join("\n");
  expect(css).toMatch(/var\(--rca-label-font-weight,\s*bold\)/);
  expect(css).toMatch(/var\(--rca-label-font-size,\s*12px\)/);
  expect(css).toMatch(/var\(--rca-z-relation-badge,\s*1\)/);
  expect(css).toMatch(/var\(--rca-relation-badge-font-size,\s*0\.75rem\)/);
});

test("boxes and token rects are scaled by the page's zoom", () => {
  const { container } = renderBoxes(
    { annotations: [tokenAnnotation("a1")] },
    pageInfo(2)
  );

  const { left, top, width, height } = box(container, "a1")!.style;
  expect({ left, top, width, height }).toEqual({
    left: "20px",
    top: "20px",
    width: "90px",
    height: "10px",
  });
  expect(tokenRects(container, "a1").map((rect) => rect.style.left)).toEqual([
    "19px",
    "69px",
  ]);
});

describe("click model", () => {
  test("shift-click toggles the selection as a user change; a plain click does not select", () => {
    const onSelectionChange = vi.fn();
    const { container } = renderBoxes({
      annotations: [tokenAnnotation("a1"), tokenAnnotation("a2")],
      defaultSelectedAnnotationIds: ["a2"],
      onSelectionChange,
    });

    fireEvent.click(box(container, "a1")!);
    expect(onSelectionChange).not.toHaveBeenCalled();
    expect(box(container, "a1")!.dataset.selected).toBe("false");

    fireEvent.click(box(container, "a1")!, { shiftKey: true });
    expect(onSelectionChange.mock.calls).toEqual([
      [["a2", "a1"], { source: "user" }],
    ]);
    expect(box(container, "a1")!.dataset.selected).toBe("true");

    fireEvent.click(box(container, "a1")!, { metaKey: true });
    expect(onSelectionChange.mock.calls.at(-1)).toEqual([
      ["a2"],
      { source: "user" },
    ]);
    expect(box(container, "a1")!.dataset.selected).toBe("false");
  });

  test("every click without a drag reports the host's annotation to onAnnotationClick", () => {
    const onAnnotationClick = vi.fn();
    const annotation = tokenAnnotation("a1");
    const { container } = renderBoxes({
      annotations: [annotation],
      onAnnotationClick,
    });
    const target = box(container, "a1")!;

    fireEvent.mouseDown(target, { clientX: 5, clientY: 5 });
    fireEvent.click(target, { clientX: 5, clientY: 5 });
    fireEvent.mouseDown(target, { clientX: 5, clientY: 5, shiftKey: true });
    fireEvent.click(target, { clientX: 6, clientY: 5, shiftKey: true });
    fireEvent.mouseDown(target, { clientX: 5, clientY: 5 });
    fireEvent.click(target, { clientX: 50, clientY: 5 });

    expect(onAnnotationClick).toHaveBeenCalledTimes(2);
    expect(onAnnotationClick.mock.calls[0][0]).toBe(annotation);
  });

  test("a plain click on a link annotation opens it; a modifier click selects it", () => {
    const onOpenLink = vi.fn();
    const onSelectionChange = vi.fn();
    const annotation = tokenAnnotation("a-link", {
      linkUrl: " https://example.com/terms ",
    });
    const { container } = renderBoxes({
      annotations: [annotation],
      onOpenLink,
      onSelectionChange,
    });

    fireEvent.click(box(container, "a-link")!);
    expect(onOpenLink.mock.calls).toEqual([
      ["https://example.com/terms", annotation],
    ]);
    expect(onSelectionChange).not.toHaveBeenCalled();

    fireEvent.click(box(container, "a-link")!, { ctrlKey: true });
    expect(onOpenLink).toHaveBeenCalledTimes(1);
    expect(onSelectionChange.mock.calls).toEqual([
      [["a-link"], { source: "user" }],
    ]);
  });

  test("hovering reports the host's annotation, then null", () => {
    const onAnnotationHover = vi.fn();
    const annotation = tokenAnnotation("a1");
    const { container } = renderBoxes({
      annotations: [annotation],
      onAnnotationHover,
    });

    fireEvent.mouseEnter(box(container, "a1")!);
    fireEvent.mouseLeave(box(container, "a1")!);

    expect(onAnnotationHover.mock.calls).toEqual([[annotation], [null]]);
  });

  test("a box removed while hovered reports null", () => {
    const onAnnotationHover = vi.fn();
    const annotation = tokenAnnotation("a1");
    const view = renderBoxes({ annotations: [annotation], onAnnotationHover });

    fireEvent.mouseEnter(box(view.container, "a1")!);
    view.rerender({ annotations: [], onAnnotationHover });

    expect(box(view.container, "a1")).toBeNull();
    expect(onAnnotationHover.mock.calls).toEqual([[annotation], [null]]);
  });

  test("presses and clicks on the host's chip content do not reach the box", () => {
    const onAnnotationClick = vi.fn();
    const onOpenLink = vi.fn();
    const { container } = renderBoxes({
      annotations: [
        tokenAnnotation("a-link", { linkUrl: "https://example.com" }),
      ],
      labelDisplay: "always",
      onAnnotationClick,
      onOpenLink,
      renderAnnotationActions: () => <i data-host-action="" />,
    });

    const action = container.querySelector("[data-host-action]")!;
    fireEvent.mouseDown(action);
    fireEvent.click(action);

    expect(onAnnotationClick).not.toHaveBeenCalled();
    expect(onOpenLink).not.toHaveBeenCalled();
  });
});
