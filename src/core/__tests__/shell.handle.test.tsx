import { act, render, renderHook } from "@testing-library/react";
import { createRef } from "react";

import { useNotifyFitWidthChanged, useRegisterFormatDriver } from "../format";
import { useRequestScroll, useScrollRequest } from "../scroll";
import { useSetControllable } from "../state/controllable";
import { useVisibleAnnotations } from "../state/visibility";
import type { AnnotatorCommonProps, AnnotatorHandle } from "../types";
import {
  FAKE_FIT_WIDTH,
  FAKE_PAGE_COUNT,
  FAKE_TEXT,
  FAKE_VISIBLE_RANGE,
  FakeAnnotator,
  annotation,
  createRecorder,
  highlight,
  settle,
} from "./fakeFormat";
import type { FakeFormatProps, FakeStatus } from "./fakeFormat";

const ANNOTATIONS = [annotation("a1"), annotation("a2"), annotation("zzz")];
const HIGHLIGHTS = [highlight("h1"), highlight("h2")];

function setup(
  common: Partial<AnnotatorCommonProps> = {},
  fake: Partial<FakeFormatProps> = {}
) {
  const handleRef = createRef<AnnotatorHandle>();
  const recorder = createRecorder();
  const props = (
    nextCommon: Partial<AnnotatorCommonProps>,
    nextFake: Partial<FakeFormatProps>
  ) => ({
    common: { annotations: ANNOTATIONS, ...nextCommon },
    fake: { recorder, ...nextFake },
    handleRef,
  });
  const view = render(<FakeAnnotator {...props(common, fake)} />);
  const root = view.container.querySelector<HTMLElement>("[data-rca-root]")!;
  return {
    handle: () => handleRef.current!,
    recorder,
    root,
    rerender(
      nextCommon: Partial<AnnotatorCommonProps> = common,
      nextFake: Partial<FakeFormatProps> = fake
    ) {
      view.rerender(<FakeAnnotator {...props(nextCommon, nextFake)} />);
    },
  };
}

test("getZoom/setZoom/zoomIn/zoomOut, clamped to [0.5, 4], step 0.1", () => {
  const onZoomChange = vi.fn();
  const { handle } = setup({ defaultZoom: 1, onZoomChange });
  expect(handle().getZoom()).toBe(1);

  act(() => handle().zoomIn());
  expect(handle().getZoom()).toBe(1.1);
  act(() => handle().zoomIn());
  expect(handle().getZoom()).toBe(1.2);
  act(() => handle().zoomOut());
  expect(handle().getZoom()).toBe(1.1);

  act(() => handle().setZoom(9));
  expect(handle().getZoom()).toBe(4);
  act(() => handle().zoomIn());
  expect(handle().getZoom()).toBe(4);

  act(() => handle().setZoom(0.1));
  expect(handle().getZoom()).toBe(0.5);
  act(() => handle().zoomOut());
  expect(handle().getZoom()).toBe(0.5);

  expect(onZoomChange).toHaveBeenLastCalledWith(0.5);
  expect(onZoomChange.mock.calls.every((call) => call.length === 1)).toBe(
    true
  );
});

test("setZoom ignores a zoom that is not a finite number", () => {
  const onZoomChange = vi.fn();
  const { handle } = setup({ defaultZoom: 1.5, onZoomChange });

  for (const zoom of [Number.NaN, Number.POSITIVE_INFINITY, -Infinity]) {
    act(() => handle().setZoom(zoom));
    expect(handle().getZoom()).toBe(1.5);
  }
  expect(onZoomChange).not.toHaveBeenCalled();
});

test("a numeric defaultZoom is clamped to [0.5, 4]; one that is not finite is ignored", () => {
  expect(setup({ defaultZoom: 9 }).handle().getZoom()).toBe(4);
  expect(setup({ defaultZoom: 0.1 }).handle().getZoom()).toBe(0.5);
  // Ignored: the default, fit-to-width, applies.
  expect(setup({ defaultZoom: Number.NaN }).handle().getZoom()).toBe(
    FAKE_FIT_WIDTH
  );
});

test("setZoom('fit-width') uses driver.resolveFitWidth()", () => {
  const { handle } = setup({ defaultZoom: 2 });
  expect(handle().getZoom()).toBe(2);

  act(() => handle().setZoom("fit-width"));

  expect(handle().getZoom()).toBe(FAKE_FIT_WIDTH);
});

test("default zoom is fit-width, resolved once the driver can measure", () => {
  const onZoomChange = vi.fn();
  const { handle, recorder, rerender } = setup(
    { onZoomChange },
    { fitWidth: null }
  );
  expect(handle().getZoom()).toBe(1);

  rerender({ onZoomChange }, { fitWidth: 2.5 });
  // The driver could measure now, but nothing has told the shell to look.
  expect(handle().getZoom()).toBe(1);

  act(() => recorder.notifyFitWidthChanged());
  expect(handle().getZoom()).toBe(2.5);
  expect(onZoomChange.mock.calls).toEqual([[2.5]]);

  // Resolved once: a later fit-width change does not move the zoom.
  rerender({ onZoomChange }, { fitWidth: 3 });
  act(() => recorder.notifyFitWidthChanged());
  expect(handle().getZoom()).toBe(2.5);
});

test("a numeric defaultZoom is not replaced by fit-width", () => {
  const { handle, recorder } = setup({ defaultZoom: 2 });
  act(() => recorder.notifyFitWidthChanged());
  expect(handle().getZoom()).toBe(2);
});

test("a zoom set through the handle before fit-width resolves is kept", () => {
  const { handle, recorder, rerender } = setup({}, { fitWidth: null });
  act(() => handle().setZoom(3));
  rerender({}, { fitWidth: 2.5 });
  act(() => recorder.notifyFitWidthChanged());
  expect(handle().getZoom()).toBe(3);
});

test("controlled zoom: setters notify only; the prop wins", () => {
  const onZoomChange = vi.fn();
  const { handle } = setup({ zoom: 1.5, onZoomChange });
  act(() => handle().zoomIn());
  expect(onZoomChange).toHaveBeenCalledWith(1.6);
  expect(handle().getZoom()).toBe(1.5);
});

test("selectAnnotations reports source 'api' and updates uncontrolled state", () => {
  const onSelectionChange = vi.fn();
  const { handle } = setup({ onSelectionChange });
  expect(handle().getSelectedAnnotationIds()).toEqual([]);

  act(() => handle().selectAnnotations(["a1", "a2"]));

  expect(onSelectionChange).toHaveBeenCalledWith(["a1", "a2"], {
    source: "api",
  });
  expect(handle().getSelectedAnnotationIds()).toEqual(["a1", "a2"]);
});

test("controlled selection: selectAnnotations calls onSelectionChange and getSelectedAnnotationIds still returns the prop", () => {
  const onSelectionChange = vi.fn();
  const { handle } = setup({
    selectedAnnotationIds: ["a1"],
    onSelectionChange,
  });

  act(() => handle().selectAnnotations(["a2"]));

  expect(onSelectionChange).toHaveBeenCalledWith(["a2"], { source: "api" });
  expect(handle().getSelectedAnnotationIds()).toEqual(["a1"]);
});

test("clearSelection -> onSelectionChange([], {source:'api'})", () => {
  const onSelectionChange = vi.fn();
  const { handle } = setup({
    defaultSelectedAnnotationIds: ["a1"],
    onSelectionChange,
  });

  act(() => handle().clearSelection());

  expect(onSelectionChange).toHaveBeenCalledWith([], { source: "api" });
  expect(handle().getSelectedAnnotationIds()).toEqual([]);
});

test("getPageCount / getVisiblePageRange / getText / findText delegate to the driver", () => {
  const { handle, recorder } = setup();
  expect(handle().getPageCount()).toBe(FAKE_PAGE_COUNT);
  expect(handle().getVisiblePageRange()).toEqual(FAKE_VISIBLE_RANGE);
  expect(handle().getText()).toBe(FAKE_TEXT);
  expect(handle().findText("doc", { caseSensitive: true })).toEqual([
    { id: "find-doc", target: { kind: "span", start: 0, end: 3 } },
  ]);
  expect(recorder.findTextCalls).toEqual([["doc", { caseSensitive: true }]]);
});

test("scrollToPage delegates and returns the driver's boolean", () => {
  const { handle, recorder } = setup();
  expect(handle().scrollToPage(2)).toBe(true);
  expect(handle().scrollToPage(7, { behavior: "auto" })).toBe(false);
  expect(recorder.scrollToPageCalls).toEqual([
    [2, "smooth"],
    [7, "auto"],
  ]);
});

test("scrollToAnnotation resolves false for an id the driver cannot draw", async () => {
  const { handle, recorder } = setup();
  const result = await settle(() => handle().scrollToAnnotation("zzz"));
  expect(result).toBe(false);
  expect(recorder.requests).toEqual([]);
});

test("scrollToAnnotation(id, {select:true}) selects then resolves true", async () => {
  const onSelectionChange = vi.fn();
  const { handle, recorder } = setup({ onSelectionChange });
  const result = await settle(() =>
    handle().scrollToAnnotation("a2", { select: true })
  );
  expect(result).toBe(true);
  expect(onSelectionChange).toHaveBeenCalledWith(["a2"], { source: "api" });
  expect(handle().getSelectedAnnotationIds()).toEqual(["a2"]);
  expect(recorder.requests).toEqual([
    {
      seq: 1,
      target: { kind: "annotation", id: "a2" },
      behavior: "smooth",
      bounded: true,
    },
  ]);
});

test("getScrollContainer returns the root element", () => {
  const { handle, root } = setup();
  expect(root).toBeInstanceOf(HTMLElement);
  expect(handle().getScrollContainer()).toBe(root);
});

test("scrollToHighlight(id, {activate:true}) sets the active highlight with source 'api'", async () => {
  const onActiveHighlightChange = vi.fn();
  const { handle, recorder } = setup({
    highlights: HIGHLIGHTS,
    onActiveHighlightChange,
  });
  const result = await settle(() =>
    handle().scrollToHighlight("h2", { activate: true, behavior: "auto" })
  );
  expect(result).toBe(true);
  // The host callback takes the id only.
  expect(onActiveHighlightChange.mock.calls).toEqual([["h2"]]);
  expect(recorder.requests).toEqual([
    {
      seq: 1,
      target: { kind: "highlight", id: "h2" },
      behavior: "auto",
      bounded: true,
    },
  ]);
});

test("renderLoading gets documentStatus.progress, renderError gets the error; with no slots the root has no extra children", () => {
  const loading: FakeStatus = { state: "loading", progress: 42, error: null };
  const failed: FakeStatus = {
    state: "error",
    progress: null,
    error: new Error("boom"),
  };
  const slots: Partial<AnnotatorCommonProps> = {
    renderLoading: (progress) => <p data-slot="loading">{progress}</p>,
    renderError: (error) => <p data-slot="error">{error.message}</p>,
  };

  const { root, rerender } = setup(slots, { status: loading });
  expect(root.querySelector('[data-slot="loading"]')?.textContent).toBe("42");
  expect(root.querySelector("[data-fake-format]")).not.toBeNull();

  rerender(slots, { status: failed });
  expect(root.querySelector('[data-slot="loading"]')).toBeNull();
  expect(root.querySelector('[data-slot="error"]')?.textContent).toBe("boom");

  rerender(slots, {});
  expect(root.querySelector("[data-slot]")).toBeNull();

  rerender({}, { status: loading });
  expect(root.children).toHaveLength(1);
  rerender({}, { status: failed });
  expect(root.children).toHaveLength(1);
  expect(root.children[0].hasAttribute("data-fake-format")).toBe(true);
});

test("className and style land on the root; a style override of --rca-z-annotation is readable via getComputedStyle", () => {
  const { root } = setup({
    className: "host-class",
    style: { background: "red", ["--rca-z-annotation" as string]: "7" },
  });
  expect(root.classList.contains("host-class")).toBe(true);
  expect(root.style.background).toBe("red");
  const computed = getComputedStyle(root);
  expect(computed.getPropertyValue("--rca-z-annotation")).toBe("7");
  expect(computed.getPropertyValue("--rca-z-highlight")).toBe("auto");
  expect(computed.getPropertyValue("--rca-z-pending")).toBe("2");
  // Structural annotations take their label's colour: no property of their own.
  expect(computed.getPropertyValue("--rca-structural-color")).toBe("");
  expect(computed.getPropertyValue("--rca-font-family")).toContain(
    "sans-serif"
  );
  expect(root.style.overflow).toBe("auto");
  expect(root.style.height).toBe("100%");
  expect(root.style.position).toBe("relative");
});

test("the root carries the instance id", () => {
  const first = setup();
  const second = setup();
  const a = first.root.getAttribute("data-rca-instance");
  const b = second.root.getAttribute("data-rca-instance");
  expect(a).toBeTruthy();
  expect(b).toBeTruthy();
  expect(a).not.toBe(b);
});

test("the handle is the same object across re-renders with new inline props", () => {
  const { handle, rerender } = setup({ onSelectionChange: () => {} });
  const first = handle();
  rerender({ onSelectionChange: () => {}, annotations: [...ANNOTATIONS] });
  expect(handle()).toBe(first);
});

test("pending-selection methods report no pending selection", () => {
  const { handle } = setup();
  expect(handle().getPendingSelection()).toBeNull();
  expect(() => handle().commitPendingSelection()).not.toThrow();
  expect(() => handle().clearPendingSelection()).not.toThrow();
});

test.each([
  ["useSetControllable", () => useSetControllable("selection")],
  ["useVisibleAnnotations", () => useVisibleAnnotations()],
  ["useRequestScroll", () => useRequestScroll()],
  ["useScrollRequest", () => useScrollRequest()],
  [
    "useRegisterFormatDriver",
    () =>
      useRegisterFormatDriver({
        kind: "span",
        getPageCount: () => null,
        getVisiblePageRange: () => null,
        getText: () => "",
        findText: () => [],
        scrollToPage: () => false,
        resolveFitWidth: () => null,
        canDraw: () => false,
      }),
  ],
  ["useNotifyFitWidthChanged", () => useNotifyFitWidthChanged()],
])("%s throws outside an annotator", (name, hook) => {
  // React re-throws a render error through a window "error" event (which
  // jsdom would print) and then logs it; keep the test output clean.
  const swallow = (event: ErrorEvent) => event.preventDefault();
  window.addEventListener("error", swallow);
  const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    expect(() => renderHook(hook)).toThrow(
      `${name} must be used inside an annotator`
    );
  } finally {
    consoleError.mockRestore();
    window.removeEventListener("error", swallow);
  }
});
