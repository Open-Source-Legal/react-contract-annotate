/**
 * The selection layer's document-level mouseup / mousemove fallback, and the
 * gesture they carry. Ported from OpenContracts'
 * `SelectionLayer.documentListeners.test.tsx` (98286cabf): the document
 * listeners attach only while a press on the layer is in progress and detach
 * after the release, so they never stay armed across unrelated mouse
 * activity. The selection itself is the store's pending selection (reached
 * here through `onTextSelect` and the handle) rather than the layer's own
 * state, so the suite also pins what a drag produces, the double-fire guard,
 * the click model (a blank click clears, a click on a box does not), Shift
 * regions across pages, Escape and touch.
 */
import { act, fireEvent } from "@testing-library/react";
import type { MockInstance } from "vitest";

import { useVisibleAnnotations } from "../../core/index";
import type {
  Annotation,
  Highlight,
  PendingSelection,
} from "../../core/index";
import { AnnotationBox } from "../AnnotationBox";
import {
  CLICK_DRAG_TOLERANCE_PX,
  LONG_PRESS_MS,
  TOUCH_MOVE_THRESHOLD_PX,
} from "../constants";
import { HighlightOverlay } from "../HighlightOverlay";
import type { PDFPageInfo } from "../PDFPageInfo";
import {
  BLANK,
  IN_HELLO,
  IN_WORLD,
  canvasOf,
  click,
  drag,
  pageInfo,
  renderLayers,
  touchAt,
} from "./selectionFixture";

vi.mock("pdfjs-dist/legacy/build/pdf.mjs", async () => {
  const { fakePdfjs: fake } = await import("./pdfjsFake");
  return { getDocument: fake.getDocument, GlobalWorkerOptions: {} };
});

const LISTENER_TYPES = ["mouseup", "mousemove"];

describe("document-level mouseup fallback", () => {
  let addSpy: MockInstance<typeof document.addEventListener>;
  let removeSpy: MockInstance<typeof document.removeEventListener>;

  beforeEach(() => {
    addSpy = vi.spyOn(document, "addEventListener");
    removeSpy = vi.spyOn(document, "removeEventListener");
  });

  afterEach(() => {
    addSpy.mockRestore();
    removeSpy.mockRestore();
  });

  const armed = (spy: MockInstance) =>
    spy.mock.calls.filter(([type]) => LISTENER_TYPES.includes(type as string));

  test("does NOT attach document mouseup/mousemove on mount", () => {
    const { unmount } = renderLayers();
    expect(armed(addSpy)).toHaveLength(0);

    unmount();
    // Nothing was armed, so nothing is removed.
    expect(armed(removeSpy)).toHaveLength(0);
  });

  test("attaches document listeners after a mousedown starts a selection", () => {
    const { layer } = renderLayers();
    addSpy.mockClear();

    fireEvent.mouseDown(layer(), {
      clientX: IN_HELLO.x,
      clientY: IN_HELLO.y,
      buttons: 1,
    });

    const types = addSpy.mock.calls.map(([type]) => type);
    expect(types).toContain("mouseup");
    expect(types).toContain("mousemove");
    // Plus the keydown that cancels the gesture on Escape.
    expect(types).toContain("keydown");
  });

  test("detaches document listeners after mouseup completes the selection", () => {
    const { layer } = renderLayers();
    fireEvent.mouseDown(layer(), {
      clientX: IN_HELLO.x,
      clientY: IN_HELLO.y,
      buttons: 1,
    });
    fireEvent.mouseMove(document, { clientX: IN_WORLD.x, clientY: IN_WORLD.y });
    removeSpy.mockClear();

    // Released over something else entirely: still finishes the selection.
    fireEvent.mouseUp(document, { clientX: IN_WORLD.x, clientY: IN_WORLD.y });

    const removedTypes = removeSpy.mock.calls.map(([type]) => type);
    expect(removedTypes).toContain("mouseup");
    expect(removedTypes).toContain("mousemove");
  });
});

describe("the gesture", () => {
  test("a drag over two tokens completes a draft of them, anchored at the release", () => {
    const onTextSelect = vi.fn();
    const { layer } = renderLayers({ onTextSelect });

    drag(layer(), IN_HELLO, IN_WORLD);

    expect(onTextSelect).toHaveBeenCalledTimes(1);
    const pending = onTextSelect.mock.calls[0][0] as PendingSelection;
    expect(pending).toMatchObject({
      rawText: "Hello world",
      page: 0,
      annotationLabel: null,
      anchor: { x: IN_WORLD.x, y: IN_WORLD.y },
    });
    expect(pending.json).toEqual({
      0: {
        bounds: { left: 7, top: 7, right: 58, bottom: 18 },
        tokensJsons: [
          { pageIndex: 0, tokenIndex: 0 },
          { pageIndex: 0, tokenIndex: 1 },
        ],
        rawText: "Hello world",
      },
    });
  });

  test("the drag is measured in page coordinates whatever the zoom", () => {
    const onTextSelect = vi.fn();
    const { layer } = renderLayers({ onTextSelect }, { zoom: 2 });

    drag(layer(), IN_HELLO, IN_WORLD, { zoom: 2 });

    const pending = onTextSelect.mock.calls[0][0] as PendingSelection;
    expect(pending.rawText).toBe("Hello world");
  });

  test("a release over the layer completes the selection once (double-fire guard)", () => {
    const onTextSelect = vi.fn();
    const { layer } = renderLayers({ onTextSelect });

    // React's onMouseUp on the layer and the document listener both hear it.
    drag(layer(), IN_HELLO, IN_WORLD, { releaseOnLayer: true });

    expect(onTextSelect).toHaveBeenCalledTimes(1);
  });

  test("starting a drag clears the annotation selection as a user change, and the pending selection", () => {
    const onSelectionChange = vi.fn();
    const onTextSelect = vi.fn();
    const { layer } = renderLayers({
      onSelectionChange,
      onTextSelect,
      defaultSelectedAnnotationIds: ["a1"],
    });
    drag(layer(), IN_HELLO, IN_WORLD);
    expect(onSelectionChange.mock.calls).toEqual([[[], { source: "user" }]]);
    expect(layer().querySelectorAll("[data-rca-pending-region]")).toHaveLength(1);

    // A second drag begins: the first pending selection is gone at once.
    fireEvent.mouseDown(layer(), {
      clientX: BLANK.x,
      clientY: BLANK.y,
      buttons: 1,
    });
    expect(layer().querySelectorAll("[data-rca-pending-region]")).toHaveLength(1);
    fireEvent.mouseMove(document, { clientX: BLANK.x + 20, clientY: BLANK.y });
    expect(layer().querySelectorAll("[data-rca-pending-region]")).toHaveLength(0);
    // The selection was already empty: no second notification.
    expect(onSelectionChange).toHaveBeenCalledTimes(1);
  });

  test("a drag that captures no token completes nothing", () => {
    const onTextSelect = vi.fn();
    const { layer } = renderLayers({ onTextSelect });

    drag(layer(), BLANK, { x: BLANK.x + 40, y: BLANK.y + 40 });

    expect(onTextSelect).not.toHaveBeenCalled();
    expect(layer().querySelectorAll("[data-rca-drag-region]")).toHaveLength(0);
  });

  test("a press on a page without tokens does nothing", () => {
    const addSpy = vi.spyOn(document, "addEventListener");
    const onTextSelect = vi.fn();
    const onSelectionChange = vi.fn();
    const { layer } = renderLayers(
      { onTextSelect, onSelectionChange, defaultSelectedAnnotationIds: ["a1"] },
      { pages: [pageInfo(1, [])] }
    );
    addSpy.mockClear();

    drag(layer(), IN_HELLO, IN_WORLD);

    expect(addSpy.mock.calls.map(([type]) => type)).not.toContain("mousemove");
    expect(onTextSelect).not.toHaveBeenCalled();
    expect(onSelectionChange).not.toHaveBeenCalled();
    addSpy.mockRestore();
  });

  test("Shift-release keeps the region; a release without Shift on another page completes one draft of both pages", () => {
    const onTextSelect = vi.fn();
    const { layer } = renderLayers(
      { onTextSelect },
      { pages: [pageInfo(1), pageInfo(2)] }
    );

    drag(layer(0), IN_HELLO, IN_WORLD, { shift: true });
    expect(onTextSelect).not.toHaveBeenCalled();
    expect(layer(0).querySelectorAll("[data-rca-drag-region]")).toHaveLength(1);

    drag(layer(1), { x: 12, y: 31 }, { x: 25, y: 33 });

    expect(onTextSelect).toHaveBeenCalledTimes(1);
    const pending = onTextSelect.mock.calls[0][0] as PendingSelection;
    expect(Object.keys(pending.json)).toEqual(["0", "1"]);
    expect(pending.page).toBe(0);
    expect(pending.rawText).toBe("Hello world again");
    expect(layer(0).querySelectorAll("[data-rca-drag-region]")).toHaveLength(0);
  });

  test("Escape cancels a drag in progress and the regions kept with Shift", () => {
    const onTextSelect = vi.fn();
    const { layer } = renderLayers({ onTextSelect });
    drag(layer(), IN_HELLO, IN_WORLD, { shift: true });

    fireEvent.mouseDown(layer(), {
      clientX: IN_HELLO.x,
      clientY: 31,
      buttons: 1,
    });
    fireEvent.mouseMove(document, { clientX: IN_WORLD.x, clientY: 34 });
    expect(layer().querySelectorAll("[data-rca-drag-region]")).toHaveLength(2);

    fireEvent.keyDown(document, { key: "Escape" });
    expect(layer().querySelectorAll("[data-rca-drag-region]")).toHaveLength(0);

    // The release that follows finds no gesture; moving no longer restarts one.
    fireEvent.mouseMove(document, { clientX: 80, clientY: 40 });
    fireEvent.mouseUp(document, { clientX: 80, clientY: 40 });
    expect(onTextSelect).not.toHaveBeenCalled();
    expect(layer().querySelectorAll("[data-rca-drag-region]")).toHaveLength(0);
  });

  test("Escape alone cancels the regions kept with Shift", () => {
    const { layer } = renderLayers();
    drag(layer(), IN_HELLO, IN_WORLD, { shift: true });
    expect(layer().querySelectorAll("[data-rca-drag-region]")).toHaveLength(1);

    act(() => {
      fireEvent.keyDown(document, { key: "Escape" });
    });

    expect(layer().querySelectorAll("[data-rca-drag-region]")).toHaveLength(0);
  });

  test("a press on a link is left to the link", () => {
    const onTextSelect = vi.fn();
    const { layer } = renderLayers(
      { onTextSelect },
      {
        content: (
          <>
            <canvas />
            <a href="https://example.com/" data-link="">
              link
            </a>
          </>
        ),
      }
    );
    const link = layer().querySelector<HTMLElement>("[data-link]")!;

    drag(link, IN_HELLO, IN_WORLD);

    expect(onTextSelect).not.toHaveBeenCalled();
  });

  test("a new document drops the regions kept with Shift", () => {
    const onTextSelect = vi.fn();
    const { layer, rerender } = renderLayers({ onTextSelect });
    drag(layer(), IN_HELLO, IN_WORLD, { shift: true });
    expect(layer().querySelectorAll("[data-rca-drag-region]")).toHaveLength(1);

    rerender({ onTextSelect }, [pageInfo(1)]);

    expect(layer().querySelectorAll("[data-rca-drag-region]")).toHaveLength(0);
    // A later drag drafts the new document's tokens only.
    drag(layer(), { x: 12, y: 31 }, { x: 25, y: 33 });
    expect((onTextSelect.mock.calls[0][0] as PendingSelection).rawText).toBe(
      "again"
    );
  });
});

describe("touch", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test("a held touch starts a selection; its release completes the word under it", () => {
    const onTextSelect = vi.fn();
    const onSelectionChange = vi.fn();
    const { layer } = renderLayers({
      onTextSelect,
      onSelectionChange,
      defaultSelectedAnnotationIds: ["a1"],
    });

    fireEvent.touchStart(layer(), { touches: touchAt(IN_HELLO) });
    act(() => {
      vi.advanceTimersByTime(LONG_PRESS_MS);
    });
    // The selection has begun: the annotation selection is cleared.
    expect(onSelectionChange.mock.calls).toEqual([[[], { source: "user" }]]);
    expect(layer().style.touchAction).toBe("none");

    fireEvent.touchEnd(layer(), { changedTouches: touchAt(IN_HELLO) });

    expect(onTextSelect).toHaveBeenCalledTimes(1);
    expect((onTextSelect.mock.calls[0][0] as PendingSelection).rawText).toBe(
      "Hello"
    );
    expect(layer().style.touchAction).toBe("auto");
  });

  test("a tap on the blank page is a blank click", () => {
    const onSelectionChange = vi.fn();
    const onTextSelect = vi.fn();
    const { layer } = renderLayers({
      defaultSelectedAnnotationIds: ["a1"],
      onSelectionChange,
      onTextSelect,
    });
    const canvas = canvasOf(layer());

    fireEvent.touchStart(canvas, { touches: touchAt(BLANK) });
    fireEvent.touchEnd(canvas, { changedTouches: touchAt(BLANK) });

    expect(onSelectionChange.mock.calls).toEqual([[[], { source: "user" }]]);
    expect(onTextSelect).not.toHaveBeenCalled();
    // The hold that was pending is over: nothing starts later.
    act(() => {
      vi.advanceTimersByTime(LONG_PRESS_MS);
    });
    expect(onSelectionChange).toHaveBeenCalledTimes(1);
  });

  test("a tap that moved away, or on a box, is not a blank click", () => {
    const page = pageInfo(1);
    const onSelectionChange = vi.fn();
    const { layer } = renderLayers(
      {
        annotations: [A1],
        defaultSelectedAnnotationIds: ["a1"],
        onSelectionChange,
      },
      { pages: [page], content: <PageContent info={page} /> }
    );
    const canvas = canvasOf(layer());
    const box = layer().querySelector<HTMLElement>('[data-rca-annotation="a1"]')!;

    fireEvent.touchStart(canvas, { touches: touchAt(BLANK) });
    fireEvent.touchMove(canvas, {
      touches: touchAt({ x: BLANK.x + TOUCH_MOVE_THRESHOLD_PX + 1, y: BLANK.y }),
    });
    fireEvent.touchEnd(canvas, { changedTouches: touchAt(BLANK) });
    fireEvent.touchStart(box, { touches: touchAt(IN_BOX) });
    fireEvent.touchEnd(box, { changedTouches: touchAt(IN_BOX) });

    expect(onSelectionChange).not.toHaveBeenCalled();
  });

  test("a touch that moves before the hold is over is not a selection", () => {
    const onTextSelect = vi.fn();
    const { layer } = renderLayers({ onTextSelect });

    fireEvent.touchStart(layer(), { touches: touchAt(IN_HELLO) });
    fireEvent.touchMove(layer(), {
      touches: touchAt({
        x: IN_HELLO.x + TOUCH_MOVE_THRESHOLD_PX + 1,
        y: IN_HELLO.y,
      }),
    });
    act(() => {
      vi.advanceTimersByTime(LONG_PRESS_MS);
    });
    fireEvent.touchEnd(layer(), { changedTouches: touchAt(IN_WORLD) });

    expect(onTextSelect).not.toHaveBeenCalled();
  });
});

/** Token annotation `a1` on "Hello world" of page 0. */
const A1: Annotation = {
  id: "a1",
  annotationLabel: { id: "l1", text: "Clause", color: "#2563eb" },
  rawText: "Hello world",
  page: 0,
  json: {
    0: {
      bounds: { left: 10, top: 10, right: 55, bottom: 15 },
      tokensJsons: [
        { pageIndex: 0, tokenIndex: 0 },
        { pageIndex: 0, tokenIndex: 1 },
      ],
      rawText: "Hello world",
    },
  },
};

/** A highlight on "Hello world" of page 0. */
const H1: Highlight = {
  id: "h1",
  target: { kind: "tokens", tokensByPage: { 0: [0, 1] } },
};

/** A point inside A1's and H1's boxes, clear of "again". */
const IN_BOX = Object.freeze({ x: 40, y: 12 });
/** A drag over "again", away from the boxes: makes a pending selection. */
const OVER_AGAIN = [
  { x: 12, y: 31 },
  { x: 25, y: 33 },
] as const;

/** The page's canvas, its annotation boxes and its highlights, as a page draws them. */
function PageContent({ info }: { info: PDFPageInfo }) {
  const annotations = useVisibleAnnotations();
  return (
    <>
      <canvas />
      <HighlightOverlay pageInfo={info} />
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

const PENDING_REGION = "[data-rca-pending-region]";

describe("clicks", () => {
  test("a click on the blank page with a selection fires one user change to [] and clears the pending selection", () => {
    const onSelectionChange = vi.fn();
    const onTextSelect = vi.fn();
    // Controlled, so the selection is still there after the drag clears it.
    const { layer } = renderLayers({
      selectedAnnotationIds: ["a1"],
      onSelectionChange,
      onTextSelect,
    });
    drag(layer(), ...OVER_AGAIN);
    expect(layer().querySelectorAll(PENDING_REGION)).toHaveLength(1);
    onSelectionChange.mockClear();

    click(canvasOf(layer()), BLANK);

    expect(onSelectionChange.mock.calls).toEqual([[[], { source: "user" }]]);
    expect(layer().querySelectorAll(PENDING_REGION)).toHaveLength(0);
    // A click selects no text.
    expect(onTextSelect).toHaveBeenCalledTimes(1);
  });

  test("a click on the layer itself, beside the canvas, is a blank click too", () => {
    const onSelectionChange = vi.fn();
    const { layer } = renderLayers({
      defaultSelectedAnnotationIds: ["a1"],
      onSelectionChange,
    });

    click(layer(), BLANK);

    expect(onSelectionChange.mock.calls).toEqual([[[], { source: "user" }]]);
  });

  test("a click on the blank page with nothing selected fires no selection change", () => {
    const onSelectionChange = vi.fn();
    const onTextSelect = vi.fn();
    const { layer } = renderLayers({ onSelectionChange, onTextSelect });

    click(canvasOf(layer()), IN_HELLO);

    expect(onSelectionChange).not.toHaveBeenCalled();
    expect(onTextSelect).not.toHaveBeenCalled();
  });

  test("a press that moves less than the tolerance, released on the blank page, is a blank click", () => {
    const onSelectionChange = vi.fn();
    const onTextSelect = vi.fn();
    const { layer } = renderLayers({
      defaultSelectedAnnotationIds: ["a1"],
      onSelectionChange,
      onTextSelect,
    });

    click(canvasOf(layer()), IN_HELLO, {
      moveBy: CLICK_DRAG_TOLERANCE_PX - 1,
    });

    expect(onSelectionChange.mock.calls).toEqual([[[], { source: "user" }]]);
    expect(onTextSelect).not.toHaveBeenCalled();
  });

  test("a press on the blank page released off it is not a blank click", () => {
    const onSelectionChange = vi.fn();
    const { layer } = renderLayers({
      defaultSelectedAnnotationIds: ["a1"],
      onSelectionChange,
    });

    click(canvasOf(layer()), BLANK, { releaseOn: document });

    expect(onSelectionChange).not.toHaveBeenCalled();
  });

  test("a click on an annotation box clears nothing and is the box's click", () => {
    const page = pageInfo(1);
    const onSelectionChange = vi.fn();
    const onAnnotationClick = vi.fn();
    const { layer } = renderLayers(
      {
        annotations: [A1],
        selectedAnnotationIds: ["a1"],
        onSelectionChange,
        onAnnotationClick,
      },
      { pages: [page], content: <PageContent info={page} /> }
    );
    drag(layer(), ...OVER_AGAIN);
    onSelectionChange.mockClear();
    const box = layer().querySelector<HTMLElement>('[data-rca-annotation="a1"]')!;

    click(box, IN_BOX);

    expect(onSelectionChange).not.toHaveBeenCalled();
    expect(layer().querySelectorAll(PENDING_REGION)).toHaveLength(1);
    expect(onAnnotationClick).toHaveBeenCalledTimes(1);
    expect(onAnnotationClick.mock.calls[0][0]).toBe(A1);
  });

  test("a click on a highlight box clears nothing and activates the highlight", () => {
    const page = pageInfo(1);
    const onSelectionChange = vi.fn();
    const onActiveHighlightChange = vi.fn();
    const { layer } = renderLayers(
      {
        highlights: [H1],
        selectedAnnotationIds: ["a1"],
        onSelectionChange,
        onActiveHighlightChange,
      },
      { pages: [page], content: <PageContent info={page} /> }
    );
    drag(layer(), ...OVER_AGAIN);
    onSelectionChange.mockClear();
    const box = layer().querySelector<HTMLElement>('[data-rca-highlight="h1"]')!;

    click(box, IN_BOX);

    expect(onSelectionChange).not.toHaveBeenCalled();
    expect(layer().querySelectorAll(PENDING_REGION)).toHaveLength(1);
    expect(onActiveHighlightChange.mock.calls).toEqual([["h1"]]);
  });
});
