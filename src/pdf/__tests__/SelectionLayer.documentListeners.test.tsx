/**
 * The selection layer's document-level mouseup / mousemove fallback, and the
 * gesture they carry. Ported from OpenContracts'
 * `SelectionLayer.documentListeners.test.tsx` (98286cabf): the document
 * listeners attach only while a press on the layer is in progress and detach
 * after the release, so they never stay armed across unrelated mouse
 * activity. The selection itself is the store's pending selection (reached
 * here through `onTextSelect` and the handle) rather than the layer's own
 * state, so the suite also pins what a drag produces, the double-fire guard,
 * clicks, Shift regions across pages and Escape.
 */
import { act, fireEvent } from "@testing-library/react";
import type { MockInstance } from "vitest";

import type { PendingSelection } from "../../core/index";
import { LONG_PRESS_MS, TOUCH_MOVE_THRESHOLD_PX } from "../constants";
import {
  BLANK,
  IN_HELLO,
  IN_WORLD,
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

  test("a press and release that does not move is a click: nothing is selected or cleared", () => {
    const onTextSelect = vi.fn();
    const onSelectionChange = vi.fn();
    const { layer } = renderLayers({
      onTextSelect,
      onSelectionChange,
      defaultSelectedAnnotationIds: ["a1"],
    });

    click(layer(), IN_HELLO);

    expect(onTextSelect).not.toHaveBeenCalled();
    expect(onSelectionChange).not.toHaveBeenCalled();
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

describe("long press on touch", () => {
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
