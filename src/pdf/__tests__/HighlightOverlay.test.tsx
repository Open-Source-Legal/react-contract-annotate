/**
 * The PDF highlight overlay: the boxes and token rects of every supplied
 * highlight on one page, rendered inside a real `AnnotatorShell` whose common
 * props drive the highlights, the display settings and the active highlight.
 *
 * Ports the translucent-fill and box-shadow-halo tests of OpenContracts'
 * `ResultBoundary.test.tsx` (98286cabf), here on the boundary of a highlight.
 */
import { fireEvent, render } from "@testing-library/react";
import type { PDFPageProxy } from "pdfjs-dist/types/src/display/api";

import { AnnotatorShell } from "../../core/index";
import type {
  AnnotatorCommonProps,
  Highlight,
  PawlsToken,
} from "../../core/index";
import { HighlightOverlay } from "../HighlightOverlay";
import { PDFPageInfo } from "../PDFPageInfo";
import {
  BOUNDARY_OPACITY_SELECTED,
  BOUNDARY_OPACITY_UNSELECTED,
  CLICK_DRAG_TOLERANCE_PX,
} from "../constants";
import { fakePage } from "./pdfjsFake";

const TOKENS: PawlsToken[] = [
  { x: 10, y: 10, width: 20, height: 5, text: "Hello" },
  { x: 35, y: 10, width: 20, height: 5, text: "world" },
  { x: 10, y: 30, width: 20, height: 5, text: "again" },
];

/** What the spanning bound of tokens 0 and 1 is: the box plus 3 units padding. */
const DERIVED = Object.freeze({ left: 7, top: 7, right: 58, bottom: 18 });

function tokensHighlight(
  id: string,
  tokens: number[] = [0, 1],
  extra: Partial<Highlight> = {}
): Highlight {
  return {
    id,
    target: { kind: "tokens", tokensByPage: { 0: tokens } },
    ...extra,
  };
}

function pageInfo(scale = 1, pageNumber = 1): PDFPageInfo {
  return new PDFPageInfo(
    fakePage(pageNumber) as unknown as PDFPageProxy,
    TOKENS,
    scale
  );
}

type Common = Partial<AnnotatorCommonProps> & { highlights?: Highlight[] };

function renderOverlay(common: Common, info = pageInfo()) {
  const tree = (next: Common) => (
    <AnnotatorShell common={{ annotations: [], ...next }} handleRef={null}>
      <HighlightOverlay pageInfo={info} />
    </AnnotatorShell>
  );
  const view = render(tree(common));
  return { ...view, rerender: (next: Common) => view.rerender(tree(next)) };
}

function box(container: HTMLElement, id: string): HTMLElement | null {
  return container.querySelector<HTMLElement>(`[data-rca-highlight="${id}"]`);
}

function boxes(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>("[data-rca-highlight]")
  );
}

function tokenRects(container: HTMLElement, id: string): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(
      `[data-rca-highlight-token="${id}"]`
    )
  );
}

function px(value: string): number {
  return Number.parseFloat(value);
}

describe("geometry", () => {
  test("HighlightOverlay derives bounds from tokens when boundsByPage is absent", () => {
    const { container } = renderOverlay(
      { highlights: [tokensHighlight("h1")] },
      pageInfo(2)
    );

    const style = box(container, "h1")!.style;
    expect(px(style.left)).toBe(DERIVED.left * 2);
    expect(px(style.top)).toBe(DERIVED.top * 2);
    expect(px(style.width)).toBe((DERIVED.right - DERIVED.left) * 2);
    expect(px(style.height)).toBe((DERIVED.bottom - DERIVED.top) * 2);
  });

  test("boundsByPage, when given, is used instead of the derived box", () => {
    const given = { left: 100, top: 200, right: 160, bottom: 230 };
    const { container } = renderOverlay({
      highlights: [
        {
          id: "h1",
          target: {
            kind: "tokens",
            tokensByPage: { 0: [0, 1] },
            boundsByPage: { 0: given },
          },
        },
      ],
    });

    const style = box(container, "h1")!.style;
    expect(px(style.left)).toBe(100);
    expect(px(style.top)).toBe(200);
    expect(px(style.width)).toBe(60);
    expect(px(style.height)).toBe(30);
  });

  test("token rects follow the tokens, scaled, one per token", () => {
    const { container } = renderOverlay(
      { highlights: [tokensHighlight("h1", [0, 2])] },
      pageInfo(2)
    );

    const rects = tokenRects(container, "h1");
    expect(rects).toHaveLength(2);
    // A rect extends one unit beyond its token on each side.
    expect(px(rects[0].style.left)).toBe(10 * 2 - 1);
    expect(px(rects[0].style.top)).toBe(10 * 2 - 1);
    expect(px(rects[0].style.width)).toBe(20 * 2 + 2);
    expect(px(rects[1].style.top)).toBe(30 * 2 - 1);
  });

  test("kind 'bounds' draws the box and no token rects", () => {
    const { container } = renderOverlay({
      highlights: [
        {
          id: "b1",
          target: {
            kind: "bounds",
            boundsByPage: { 0: { left: 5, top: 6, right: 25, bottom: 16 } },
          },
        },
      ],
    });

    const style = box(container, "b1")!.style;
    expect(px(style.left)).toBe(5);
    expect(px(style.width)).toBe(20);
    expect(container.querySelectorAll("[data-rca-highlight-token]")).toHaveLength(
      0
    );
    expect(container.querySelectorAll("[data-rca-token]")).toHaveLength(0);
  });

  test("a token index past the end of the page is skipped", () => {
    const { container } = renderOverlay({
      highlights: [tokensHighlight("h1", [0, 99, 1])],
    });

    expect(tokenRects(container, "h1")).toHaveLength(2);
    // The box wraps the tokens that exist.
    const style = box(container, "h1")!.style;
    expect(px(style.left)).toBe(DERIVED.left);
    expect(px(style.width)).toBe(DERIVED.right - DERIVED.left);
  });

  test("a highlight none of whose tokens exist draws nothing", () => {
    const { container } = renderOverlay({
      highlights: [tokensHighlight("h1", [98, 99])],
    });

    expect(boxes(container)).toHaveLength(0);
    expect(tokenRects(container, "h1")).toHaveLength(0);
  });

  test("only the highlights with something on this page are painted", () => {
    const { container } = renderOverlay({
      highlights: [
        tokensHighlight("here"),
        {
          id: "elsewhere",
          target: { kind: "tokens", tokensByPage: { 3: [0] } },
        },
      ],
    });

    expect(boxes(container).map((b) => b.dataset.rcaHighlight)).toEqual([
      "here",
    ]);
    expect(box(container, "here")!.dataset.rcaPagePart).toBe("0");
  });

  test("the page a highlight is drawn on is the page's own index", () => {
    const { container } = renderOverlay(
      {
        highlights: [
          {
            id: "h1",
            target: { kind: "tokens", tokensByPage: { 4: [0, 1] } },
          },
        ],
      },
      pageInfo(1, 5)
    );

    expect(box(container, "h1")!.dataset.rcaPagePart).toBe("4");
  });
});

describe("what is painted", () => {
  test("every supplied highlight is painted; only the active one is data-active", () => {
    const { container } = renderOverlay({
      highlights: [
        tokensHighlight("h1", [0]),
        tokensHighlight("h2", [1]),
        tokensHighlight("h3", [2]),
      ],
      activeHighlightId: "h2",
    });

    expect(boxes(container)).toHaveLength(3);
    expect(box(container, "h1")!.hasAttribute("data-active")).toBe(false);
    expect(box(container, "h2")!.hasAttribute("data-active")).toBe(true);
    expect(box(container, "h3")!.hasAttribute("data-active")).toBe(false);
    expect(container.querySelectorAll("[data-active]")).toHaveLength(1);
  });

  test("the active highlight changes with the active highlight prop", () => {
    const highlights = [tokensHighlight("h1", [0]), tokensHighlight("h2", [1])];
    const view = renderOverlay({ highlights, activeHighlightId: "h1" });
    expect(box(view.container, "h1")!.hasAttribute("data-active")).toBe(true);

    view.rerender({ highlights, activeHighlightId: "h2" });
    expect(box(view.container, "h1")!.hasAttribute("data-active")).toBe(false);
    expect(box(view.container, "h2")!.hasAttribute("data-active")).toBe(true);

    view.rerender({ highlights, activeHighlightId: null });
    expect(view.container.querySelectorAll("[data-active]")).toHaveLength(0);
  });

  test("nothing is painted without highlights", () => {
    const { container } = renderOverlay({});
    expect(container.querySelector("[data-rca-root]")!.children).toHaveLength(
      0
    );
  });

  test("kind 'span' draws nothing and warns once in development", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const span = (id: string): Highlight => ({
      id,
      target: { kind: "span", start: 0, end: 4 },
    });

    const view = renderOverlay({ highlights: [span("s1"), span("s2")] });
    view.rerender({ highlights: [span("s1"), span("s2"), span("s3")] });

    expect(boxes(view.container)).toHaveLength(0);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain("span");
    warn.mockRestore();
  });

  test("a span highlight alongside others does not stop them being painted", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { container } = renderOverlay({
      highlights: [
        { id: "s1", target: { kind: "span", start: 0, end: 4 } },
        tokensHighlight("h1"),
      ],
    });

    expect(boxes(container).map((b) => b.dataset.rcaHighlight)).toEqual(["h1"]);
    warn.mockRestore();
  });

  test("no warning in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    renderOverlay({
      highlights: [{ id: "s1", target: { kind: "span", start: 0, end: 4 } }],
    });

    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
    vi.unstubAllEnvs();
  });
});

describe("colour", () => {
  // #0066cc is rgb(0, 102, 204); the fill is rgba(r, g, b, opacity).
  test("the unselected fill is drawn even when bounding boxes are hidden", () => {
    const { container } = renderOverlay({
      highlights: [tokensHighlight("h1", [0, 1], { color: "#0066cc" })],
      showBoundingBoxes: false,
    });

    expect(box(container, "h1")!.style.background).toBe(
      `rgba(0, 102, 204, ${BOUNDARY_OPACITY_UNSELECTED})`
    );
  });

  test("the active highlight gets the stronger, selected fill", () => {
    const { container } = renderOverlay({
      highlights: [tokensHighlight("h1", [0, 1], { color: "#0066cc" })],
      activeHighlightId: "h1",
      showBoundingBoxes: false,
    });

    expect(box(container, "h1")!.style.background).toBe(
      `rgba(0, 102, 204, ${BOUNDARY_OPACITY_SELECTED})`
    );
  });

  test("the box-shadow halo follows showBoundingBoxes, and is stronger when active", () => {
    const highlights = [
      tokensHighlight("a", [0], { color: "#0066cc" }),
      tokensHighlight("b", [1], { color: "#0066cc" }),
    ];
    const hidden = renderOverlay({ highlights, showBoundingBoxes: false });
    expect(box(hidden.container, "a")!.style.boxShadow).toBe("none");
    hidden.unmount();

    const shown = renderOverlay({
      highlights,
      showBoundingBoxes: true,
      activeHighlightId: "b",
    });
    const idle = box(shown.container, "a")!.style.boxShadow;
    const active = box(shown.container, "b")!.style.boxShadow;
    expect(idle).not.toBe("none");
    expect(idle).not.toBe("");
    expect(active).not.toBe("none");
    expect(active).not.toBe(idle);
  });

  test("a highlight without a colour is drawn in the default highlight colour", () => {
    const { container } = renderOverlay({
      highlights: [tokensHighlight("h1")],
    });

    // #0EA5E9 is rgb(14, 165, 233).
    expect(box(container, "h1")!.style.background).toBe(
      `rgba(14, 165, 233, ${BOUNDARY_OPACITY_UNSELECTED})`
    );
  });

  test("a colour that is not a safe CSS colour falls back to the default", () => {
    const { container } = renderOverlay({
      highlights: [
        tokensHighlight("h1", [0, 1], { color: "red; } body { x:y" }),
      ],
    });

    expect(box(container, "h1")!.style.background).toBe(
      `rgba(14, 165, 233, ${BOUNDARY_OPACITY_UNSELECTED})`
    );
    expect(tokenRects(container, "h1")[0].style.backgroundColor).not.toContain(
      "body"
    );
  });

  test("the token rects use the highlight's colour", () => {
    const { container } = renderOverlay({
      highlights: [tokensHighlight("h1", [0], { color: "#0066cc" })],
    });

    expect(tokenRects(container, "h1")[0].style.backgroundColor).toBe(
      "rgb(0, 102, 204)"
    );
  });
});

describe("stacking", () => {
  test("the box's z-index is --rca-z-highlight, defaulting to auto", () => {
    const { container } = renderOverlay({ highlights: [tokensHighlight("h1")] });

    expect(box(container, "h1")!.style.zIndex).toBe(
      "var(--rca-z-highlight, auto)"
    );
  });
});

describe("label", () => {
  const labelled = [tokensHighlight("h1", [0, 1], { label: "Search hit 3" })];
  const chip = (container: HTMLElement) =>
    container.querySelector<HTMLElement>("[data-rca-label-chip]");

  test("labelDisplay 'always' shows the highlight's label text", () => {
    const { container } = renderOverlay({
      highlights: labelled,
      labelDisplay: "always",
    });

    expect(chip(container)?.textContent).toBe("Search hit 3");
  });

  test("labelDisplay 'hover' shows it while hovered or active", () => {
    const view = renderOverlay({ highlights: labelled, labelDisplay: "hover" });
    expect(chip(view.container)).toBeNull();

    fireEvent.mouseEnter(box(view.container, "h1")!);
    expect(chip(view.container)?.textContent).toBe("Search hit 3");
    fireEvent.mouseLeave(box(view.container, "h1")!);
    expect(chip(view.container)).toBeNull();

    view.rerender({
      highlights: labelled,
      labelDisplay: "hover",
      activeHighlightId: "h1",
    });
    expect(chip(view.container)?.textContent).toBe("Search hit 3");
  });

  test("labelDisplay 'hide' shows no label", () => {
    const { container } = renderOverlay({
      highlights: labelled,
      labelDisplay: "hide",
      activeHighlightId: "h1",
    });
    expect(chip(container)).toBeNull();
  });

  test("a highlight without a label has no chip", () => {
    const { container } = renderOverlay({
      highlights: [tokensHighlight("h1")],
      labelDisplay: "always",
    });
    expect(chip(container)).toBeNull();
  });
});

describe("clicks", () => {
  function press(target: HTMLElement, at: [number, number], release = at) {
    fireEvent.mouseDown(target, { clientX: at[0], clientY: at[1] });
    fireEvent.click(target, { clientX: release[0], clientY: release[1] });
  }

  test("a click makes the highlight the active one, as a user change", () => {
    const onActiveHighlightChange = vi.fn();
    const onSelectionChange = vi.fn();
    const { container } = renderOverlay({
      highlights: [tokensHighlight("h1", [0]), tokensHighlight("h2", [1])],
      onActiveHighlightChange,
      onSelectionChange,
    });

    press(box(container, "h2")!, [5, 5]);

    expect(onActiveHighlightChange.mock.calls).toEqual([["h2"]]);
    expect(onSelectionChange).not.toHaveBeenCalled();
    // Uncontrolled: it became active.
    expect(box(container, "h2")!.hasAttribute("data-active")).toBe(true);
    expect(box(container, "h1")!.hasAttribute("data-active")).toBe(false);
  });

  test("a controlled active highlight is left for the host to apply", () => {
    const onActiveHighlightChange = vi.fn();
    const { container } = renderOverlay({
      highlights: [tokensHighlight("h1", [0])],
      activeHighlightId: null,
      onActiveHighlightChange,
    });

    press(box(container, "h1")!, [5, 5]);

    expect(onActiveHighlightChange.mock.calls).toEqual([["h1"]]);
    expect(box(container, "h1")!.hasAttribute("data-active")).toBe(false);
  });

  test("a press that moved further than the drag tolerance is not a click", () => {
    const onActiveHighlightChange = vi.fn();
    const { container } = renderOverlay({
      highlights: [tokensHighlight("h1", [0])],
      onActiveHighlightChange,
    });

    press(box(container, "h1")!, [5, 5], [5 + CLICK_DRAG_TOLERANCE_PX + 20, 5]);

    expect(onActiveHighlightChange).not.toHaveBeenCalled();
  });

  test("a plain press is not stopped: it still reaches the layers below", () => {
    const below = vi.fn();
    const view = render(
      <AnnotatorShell
        common={{ annotations: [], highlights: [tokensHighlight("h1", [0])] }}
        handleRef={null}
      >
        <div onMouseDown={below}>
          <HighlightOverlay pageInfo={pageInfo()} />
        </div>
      </AnnotatorShell>
    );

    fireEvent.mouseDown(box(view.container, "h1")!, { clientX: 5, clientY: 5 });

    expect(below).toHaveBeenCalledTimes(1);
  });
});
