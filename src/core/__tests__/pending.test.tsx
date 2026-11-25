import { act, fireEvent, render, renderHook } from "@testing-library/react";
import { useAtomValue } from "jotai";
import { createRef } from "react";

import { AnnotatorShell } from "../AnnotatorShell";
import {
  useCompleteSelection,
  usePendingActions,
  usePendingSelection,
} from "../pending";
import { useAnnotatorStore } from "../state/AnnotatorProvider";
import { annotationsAtom } from "../state/atoms";
import type {
  AnnotationDraft,
  AnnotationLabel,
  AnnotatorCommonProps,
  AnnotatorHandle,
  PendingActions,
  PendingSelection,
  SelectionMenuContext,
} from "../types";
import {
  FAKE_ANCHOR,
  FAKE_DRAFT,
  FakeAnnotator,
  LOADING,
  READY,
  annotation,
  createRecorder,
} from "./fakeFormat";
import type { FakeStatus } from "./fakeFormat";

const ACTIVE: AnnotationLabel = { id: "active", text: "Active" };
const CHOSEN: AnnotationLabel = { id: "chosen", text: "Chosen" };
const MENU = "[data-rca-selection-menu]";

function setup(common: Partial<AnnotatorCommonProps> = {}) {
  const handleRef = createRef<AnnotatorHandle>();
  const recorder = createRecorder();
  const props = (next: Partial<AnnotatorCommonProps>) => ({
    common: { annotations: [annotation("a1")], ...next },
    fake: { recorder },
    handleRef,
  });
  const view = render(<FakeAnnotator {...props(common)} />);
  const root = view.container.querySelector<HTMLElement>("[data-rca-root]")!;
  const button = root.querySelector<HTMLElement>("[data-fake-select]")!;
  return {
    handle: () => handleRef.current!,
    recorder,
    root,
    /** The fake format's "select" button: completes `FAKE_DRAFT`. */
    select: () => fireEvent.click(button),
    menu: () => document.body.querySelector<HTMLElement>(MENU),
    rerender: (next: Partial<AnnotatorCommonProps>) =>
      view.rerender(<FakeAnnotator {...props(next)} />),
  };
}

/** A format of its own, for tests that mount the shell without the fake. */
function Completer() {
  const complete = useCompleteSelection();
  return (
    <button
      data-completer=""
      onClick={() => complete(FAKE_DRAFT, FAKE_ANCHOR)}
    />
  );
}

/** What a completed `FAKE_DRAFT` leaves pending. */
const PENDING: PendingSelection = { ...FAKE_DRAFT, anchor: FAKE_ANCHOR };
/** `FAKE_DRAFT` as the host receives it: the draft without the anchor. */
const DRAFT: AnnotationDraft = { ...FAKE_DRAFT };

test("onTextSelect always fires first with the pending selection and actions", () => {
  const onTextSelect = vi.fn();
  const onCreateAnnotation = vi.fn();
  const { select, handle } = setup({
    onTextSelect,
    onCreateAnnotation,
    activeLabel: ACTIVE,
  });
  onTextSelect.mockImplementation(() => {
    // The selection is already pending while the host is told about it.
    expect(handle().getPendingSelection()).toEqual(PENDING);
  });

  select();

  expect(onTextSelect).toHaveBeenCalledTimes(1);
  const [pending, actions] = onTextSelect.mock.calls[0] as [
    PendingSelection,
    PendingActions,
  ];
  expect(pending).toEqual(PENDING);
  expect(actions.pending).toBe(pending);
  expect(actions.anchor).toEqual(FAKE_ANCHOR);
  expect(actions.commit).toEqual(expect.any(Function));
  expect(actions.clear).toEqual(expect.any(Function));
  expect(actions.copyText).toEqual(expect.any(Function));
  // Before the outcome, which here commits.
  expect(onCreateAnnotation).toHaveBeenCalledTimes(1);
  expect(onTextSelect.mock.invocationCallOrder[0]).toBeLessThan(
    onCreateAnnotation.mock.invocationCallOrder[0]
  );
});

test("onTextSelect fires in every outcome, read-only included", () => {
  const onTextSelect = vi.fn();
  const slot = setup({
    onTextSelect,
    renderSelectionMenu: () => <i data-testid="slot" />,
  });
  slot.select();
  expect(onTextSelect).toHaveBeenCalledTimes(1);

  const readOnly = setup({ onTextSelect, readOnly: true, activeLabel: ACTIVE });
  readOnly.select();
  expect(onTextSelect).toHaveBeenCalledTimes(2);
});

test("outcome 1: with renderSelectionMenu the slot is rendered, selection stays pending, onCreateAnnotation not called", () => {
  const onCreateAnnotation = vi.fn();
  const renderSelectionMenu = vi.fn((_ctx: SelectionMenuContext) => (
    <i data-testid="slot" />
  ));
  const { select, menu, handle } = setup({
    onCreateAnnotation,
    renderSelectionMenu,
    // Not read-only with an active label: without the slot this would commit.
    activeLabel: ACTIVE,
  });
  expect(menu()).toBeNull();

  select();

  expect(menu()?.querySelector("[data-testid=slot]")).not.toBeNull();
  const ctx = renderSelectionMenu.mock.lastCall![0];
  expect(ctx.pending).toEqual(PENDING);
  // The slot gets the anchor as given, not the clamped menu position.
  expect(ctx.anchor).toEqual({ x: 100, y: 120 });
  expect(ctx.commit).toEqual(expect.any(Function));
  expect(ctx.clear).toEqual(expect.any(Function));
  expect(ctx.copyText).toEqual(expect.any(Function));
  expect(handle().getPendingSelection()).toEqual(PENDING);
  expect(onCreateAnnotation).not.toHaveBeenCalled();
});

test("outcome 1: slot commit(label) calls onCreateAnnotation with that label and clears pending", () => {
  const onCreateAnnotation = vi.fn();
  const { select, menu, handle } = setup({
    onCreateAnnotation,
    activeLabel: ACTIVE,
    renderSelectionMenu: (ctx) => (
      <button data-testid="commit" onClick={() => ctx.commit(CHOSEN)} />
    ),
  });
  select();

  fireEvent.click(menu()!.querySelector("[data-testid=commit]")!);

  expect(onCreateAnnotation).toHaveBeenCalledTimes(1);
  expect(onCreateAnnotation).toHaveBeenCalledWith({
    ...DRAFT,
    annotationLabel: CHOSEN,
  });
  expect(handle().getPendingSelection()).toBeNull();
  expect(menu()).toBeNull();
});

test("outcome 1: slot clear() drops the selection and unmounts the menu", () => {
  const onCreateAnnotation = vi.fn();
  const { select, menu, handle } = setup({
    onCreateAnnotation,
    renderSelectionMenu: (ctx) => (
      <button data-testid="clear" onClick={() => ctx.clear()} />
    ),
  });
  select();

  fireEvent.click(menu()!.querySelector("[data-testid=clear]")!);

  expect(handle().getPendingSelection()).toBeNull();
  expect(menu()).toBeNull();
  expect(onCreateAnnotation).not.toHaveBeenCalled();
});

test("outcome 2: no slot + activeLabel + not readOnly -> onCreateAnnotation({...draft, annotationLabel: activeLabel}) once, pending null", () => {
  const onCreateAnnotation = vi.fn();
  const { select, handle, menu } = setup({
    onCreateAnnotation,
    activeLabel: ACTIVE,
  });

  select();

  expect(onCreateAnnotation).toHaveBeenCalledTimes(1);
  // The draft only: the anchor is not part of what the host persists.
  expect(onCreateAnnotation).toHaveBeenCalledWith({
    ...DRAFT,
    annotationLabel: ACTIVE,
  });
  expect(handle().getPendingSelection()).toBeNull();
  expect(menu()).toBeNull();
});

test("outcome 2 without onCreateAnnotation still clears the selection", () => {
  const { select, handle } = setup({ activeLabel: ACTIVE });
  select();
  expect(handle().getPendingSelection()).toBeNull();
});

test("outcome 3: no slot + no activeLabel -> pending stays until handle.clearPendingSelection()", () => {
  const onCreateAnnotation = vi.fn();
  const { select, handle } = setup({ onCreateAnnotation });

  select();

  expect(handle().getPendingSelection()).toEqual(PENDING);
  expect(onCreateAnnotation).not.toHaveBeenCalled();

  act(() => handle().clearPendingSelection());
  expect(handle().getPendingSelection()).toBeNull();
});

test("outcome 3: readOnly with activeLabel also stays pending and never calls onCreateAnnotation", () => {
  const onCreateAnnotation = vi.fn();
  const { select, handle } = setup({
    onCreateAnnotation,
    readOnly: true,
    activeLabel: ACTIVE,
  });

  select();

  expect(handle().getPendingSelection()).toEqual(PENDING);
  expect(onCreateAnnotation).not.toHaveBeenCalled();
});

test("commit with no label and no activeLabel passes annotationLabel: null", () => {
  const onCreateAnnotation = vi.fn();
  const { select, handle } = setup({ onCreateAnnotation });
  select();

  act(() => handle().commitPendingSelection());

  expect(onCreateAnnotation).toHaveBeenCalledTimes(1);
  expect(onCreateAnnotation).toHaveBeenCalledWith({
    ...DRAFT,
    annotationLabel: null,
  });
  expect(handle().getPendingSelection()).toBeNull();
});

test("commit with no label falls back to activeLabel; a given label wins", () => {
  const onCreateAnnotation = vi.fn();
  const { select, handle } = setup({
    onCreateAnnotation,
    activeLabel: ACTIVE,
    renderSelectionMenu: () => null,
  });
  select();
  act(() => handle().commitPendingSelection());
  expect(onCreateAnnotation).toHaveBeenLastCalledWith({
    ...DRAFT,
    annotationLabel: ACTIVE,
  });

  select();
  act(() => handle().commitPendingSelection(CHOSEN));
  expect(onCreateAnnotation).toHaveBeenLastCalledWith({
    ...DRAFT,
    annotationLabel: CHOSEN,
  });
});

test("commit with nothing pending does nothing", () => {
  const onCreateAnnotation = vi.fn();
  const { handle } = setup({ onCreateAnnotation, activeLabel: ACTIVE });
  expect(() => act(() => handle().commitPendingSelection())).not.toThrow();
  expect(onCreateAnnotation).not.toHaveBeenCalled();
});

test("readOnly: commit is a no-op that leaves the selection pending", () => {
  const onCreateAnnotation = vi.fn();
  const { select, handle } = setup({
    onCreateAnnotation,
    readOnly: true,
    renderSelectionMenu: (ctx) => (
      <button data-testid="commit" onClick={() => ctx.commit(CHOSEN)} />
    ),
  });
  select();

  act(() => handle().commitPendingSelection(CHOSEN));
  fireEvent.click(document.body.querySelector("[data-testid=commit]")!);

  expect(onCreateAnnotation).not.toHaveBeenCalled();
  expect(handle().getPendingSelection()).toEqual(PENDING);
});

test("commit reads readOnly and activeLabel when it runs, not when the selection completed", () => {
  const onCreateAnnotation = vi.fn();
  const common = { onCreateAnnotation, renderSelectionMenu: () => null };
  const { select, handle, rerender } = setup(common);
  select();

  rerender({ ...common, readOnly: true });
  act(() => handle().commitPendingSelection());
  expect(onCreateAnnotation).not.toHaveBeenCalled();

  rerender({ ...common, activeLabel: ACTIVE });
  act(() => handle().commitPendingSelection());
  expect(onCreateAnnotation).toHaveBeenCalledWith({
    ...DRAFT,
    annotationLabel: ACTIVE,
  });
});

test("the newest callbacks are used, however often the host re-renders with new ones", () => {
  const first = vi.fn();
  const second = vi.fn();
  const { select, handle, rerender } = setup({ onCreateAnnotation: first });
  select();

  rerender({ onCreateAnnotation: second });
  act(() => handle().commitPendingSelection());

  expect(first).not.toHaveBeenCalled();
  expect(second).toHaveBeenCalledTimes(1);
});

test("an onTextSelect that commits or clears the selection itself suppresses the outcome", () => {
  const onCreateAnnotation = vi.fn();
  const handled = setup({
    activeLabel: ACTIVE,
    onCreateAnnotation,
    onTextSelect: (_pending, actions) => actions.commit(CHOSEN),
  });
  handled.select();
  // Once, with the host's label: the active-label commit did not also run.
  expect(onCreateAnnotation).toHaveBeenCalledTimes(1);
  expect(onCreateAnnotation).toHaveBeenCalledWith({
    ...DRAFT,
    annotationLabel: CHOSEN,
  });

  onCreateAnnotation.mockClear();
  const cleared = setup({
    activeLabel: ACTIVE,
    onCreateAnnotation,
    onTextSelect: (_pending, actions) => actions.clear(),
  });
  cleared.select();
  expect(onCreateAnnotation).not.toHaveBeenCalled();
  expect(cleared.handle().getPendingSelection()).toBeNull();
});

test("Escape clears a pending selection", () => {
  const { select, handle, root } = setup();
  // Focusable, so a click inside the document focuses it and Escape lands here.
  expect(root.tabIndex).toBe(-1);
  select();
  expect(handle().getPendingSelection()).not.toBeNull();

  fireEvent.keyDown(root, { key: "Escape" });
  expect(handle().getPendingSelection()).toBeNull();
});

test("Escape anywhere on the window clears a pending selection; other keys do not", () => {
  const { select, handle } = setup();
  select();

  fireEvent.keyDown(document.body, { key: "Enter" });
  expect(handle().getPendingSelection()).not.toBeNull();

  fireEvent.keyDown(document.body, { key: "Escape" });
  expect(handle().getPendingSelection()).toBeNull();
});

test("Escape closes the selection menu", () => {
  const { select, menu } = setup({ renderSelectionMenu: () => <i /> });
  select();
  expect(menu()).not.toBeNull();

  fireEvent.keyDown(document.body, { key: "Escape" });
  expect(menu()).toBeNull();
});

test("the window listens for Escape only while a selection is pending", () => {
  const add = vi.spyOn(window, "addEventListener");
  const remove = vi.spyOn(window, "removeEventListener");
  const keydown = (spy: typeof add) =>
    spy.mock.calls.filter(([type]) => type === "keydown");
  try {
    const { select, handle } = setup();
    expect(keydown(add)).toHaveLength(0);

    select();
    expect(keydown(add)).toHaveLength(1);
    expect(keydown(remove)).toHaveLength(0);

    act(() => handle().clearPendingSelection());
    expect(keydown(remove)).toHaveLength(1);
    expect(keydown(remove)[0][1]).toBe(keydown(add)[0][1]);
  } finally {
    add.mockRestore();
    remove.mockRestore();
  }
});

test("the window stops listening when the annotator unmounts with a selection pending", () => {
  const remove = vi.spyOn(window, "removeEventListener");
  try {
    const handleRef = createRef<AnnotatorHandle>();
    const recorder = createRecorder();
    const view = render(
      <FakeAnnotator
        common={{ annotations: [] }}
        fake={{ recorder }}
        handleRef={handleRef}
      />
    );
    fireEvent.click(view.container.querySelector("[data-fake-select]")!);
    view.unmount();
    expect(remove.mock.calls.some(([type]) => type === "keydown")).toBe(true);
  } finally {
    remove.mockRestore();
  }
});

test("a second completed selection replaces the first", () => {
  const onTextSelect = vi.fn();
  const { select, recorder, handle } = setup({
    onTextSelect,
    renderSelectionMenu: () => <i />,
  });
  select();
  const second: AnnotationDraft = {
    json: { start: 20, end: 24 },
    rawText: "later",
    page: 1,
    annotationLabel: null,
  };

  act(() => recorder.completeSelection(second, { x: 5, y: 6 }));

  expect(handle().getPendingSelection()).toEqual({
    ...second,
    anchor: { x: 5, y: 6 },
  });
  expect(onTextSelect).toHaveBeenCalledTimes(2);
  expect(document.body.querySelectorAll(MENU)).toHaveLength(1);
});

test("actions given to onTextSelect belong to their selection: once replaced they do nothing", () => {
  const onCreateAnnotation = vi.fn();
  const seen: PendingActions[] = [];
  const { select, recorder, handle } = setup({
    onCreateAnnotation,
    onTextSelect: (_pending, actions) => seen.push(actions),
  });
  select();
  act(() =>
    recorder.completeSelection({ ...FAKE_DRAFT, rawText: "later" }, FAKE_ANCHOR)
  );

  act(() => seen[0].commit(CHOSEN));
  act(() => seen[0].clear());
  expect(onCreateAnnotation).not.toHaveBeenCalled();
  expect(handle().getPendingSelection()?.rawText).toBe("later");

  act(() => seen[1].commit(CHOSEN));
  expect(onCreateAnnotation).toHaveBeenCalledTimes(1);
  expect(onCreateAnnotation.mock.calls[0][0].rawText).toBe("later");
});

describe("copyText", () => {
  const original = Object.getOwnPropertyDescriptor(navigator, "clipboard");
  function stubClipboard(clipboard: unknown) {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: clipboard,
    });
  }
  afterEach(() => {
    if (original) Object.defineProperty(navigator, "clipboard", original);
    else delete (navigator as { clipboard?: unknown }).clipboard;
  });

  /** A slot that exposes its actions to the test. */
  function withSlot() {
    let ctx!: SelectionMenuContext;
    const view = setup({
      renderSelectionMenu: (next) => {
        ctx = next;
        return <i />;
      },
    });
    return { ...view, ctx: () => ctx };
  }

  test("writes pending.rawText to the clipboard and resolves true", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubClipboard({ writeText });
    const { select, ctx } = withSlot();
    select();

    await expect(ctx().copyText()).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith("sample");
  });

  test("resolves false when the clipboard is unavailable", async () => {
    stubClipboard(undefined);
    const { select, ctx } = withSlot();
    select();
    await expect(ctx().copyText()).resolves.toBe(false);
  });

  test("resolves false when writeText rejects or throws", async () => {
    const { select, ctx } = withSlot();
    select();

    stubClipboard({ writeText: vi.fn().mockRejectedValue(new Error("denied")) });
    await expect(ctx().copyText()).resolves.toBe(false);

    stubClipboard({
      writeText: () => {
        throw new Error("blocked");
      },
    });
    await expect(ctx().copyText()).resolves.toBe(false);
  });

  test("resolves false, and writes nothing, when nothing is pending", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubClipboard({ writeText });
    const { select, ctx, handle } = withSlot();
    select();
    const staleCtx = ctx();
    act(() => handle().clearPendingSelection());

    await expect(staleCtx.copyText()).resolves.toBe(false);
    expect(writeText).not.toHaveBeenCalled();
  });
});

describe("onCreateAnnotation returning a promise", () => {
  test("clears the selection without waiting for it", () => {
    const onCreateAnnotation = vi.fn(() => new Promise<void>(() => {}));
    const { select, handle } = setup({
      onCreateAnnotation,
      activeLabel: ACTIVE,
    });
    select();
    expect(handle().getPendingSelection()).toBeNull();
  });

  test("a rejection is reported through onError", async () => {
    const failure = new Error("save failed");
    const onError = vi.fn();
    const { select } = setup({
      onError,
      onCreateAnnotation: () => Promise.reject(failure),
      activeLabel: ACTIVE,
    });
    select();
    await act(async () => {});
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(failure);
  });

  test("a rejection that is not an Error is wrapped in one", async () => {
    const onError = vi.fn();
    const { select } = setup({
      onError,
      onCreateAnnotation: () => Promise.reject("nope"),
      activeLabel: ACTIVE,
    });
    select();
    await act(async () => {});
    const reported = onError.mock.calls[0][0];
    expect(reported).toBeInstanceOf(Error);
    expect(reported.message).toBe("nope");
  });

  test("a synchronous throw is reported through onError like a rejection, and the selection stays pending", () => {
    const failure = new Error("save failed at once");
    const onError = vi.fn();
    const { select, handle, menu } = setup({
      onError,
      onCreateAnnotation: () => {
        throw failure;
      },
      renderSelectionMenu: (ctx) => (
        <button data-testid="commit" onClick={() => ctx.commit(CHOSEN)} />
      ),
    });
    select();

    expect(() =>
      fireEvent.click(menu()!.querySelector("[data-testid=commit]")!)
    ).not.toThrow();
    expect(onError.mock.calls).toEqual([[failure]]);
    // Nothing was created: the selection and its menu are still there.
    expect(handle().getPendingSelection()).toEqual(PENDING);
    expect(menu()).not.toBeNull();
  });

  test("a synchronous throw from the immediate commit (outcome 2) does not escape the format", () => {
    const failure = new Error("save failed at once");
    const onError = vi.fn();
    const { select, handle } = setup({
      onError,
      onCreateAnnotation: () => {
        throw failure;
      },
      activeLabel: ACTIVE,
    });

    expect(() => select()).not.toThrow();
    expect(onError.mock.calls).toEqual([[failure]]);
    expect(handle().getPendingSelection()).toEqual(PENDING);
  });

  test("without onError a rejection is neither unhandled nor silent", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const { select } = setup({
        onCreateAnnotation: () => Promise.reject(new Error("save failed")),
        activeLabel: ACTIVE,
      });
      select();
      await act(async () => {});
      // A rejection nobody caught would fail the run; the library's catch
      // leaves a development warning instead.
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).toContain("save failed");
    } finally {
      warn.mockRestore();
    }
  });
});

describe("a pending selection belongs to one document", () => {
  function setupWithStatus(common: Partial<AnnotatorCommonProps>) {
    const handleRef = createRef<AnnotatorHandle>();
    const recorder = createRecorder();
    const element = (status: FakeStatus) => (
      <FakeAnnotator
        common={{ annotations: [annotation("a1")], ...common }}
        fake={{ recorder, status }}
        handleRef={handleRef}
      />
    );
    const view = render(element(READY));
    const button = view.container.querySelector<HTMLElement>(
      "[data-fake-select]"
    )!;
    return {
      handle: () => handleRef.current!,
      select: () => fireEvent.click(button),
      menu: () => document.body.querySelector<HTMLElement>(MENU),
      status: (next: FakeStatus) => view.rerender(element(next)),
    };
  }

  test("it is cleared when the viewer starts loading another document, with its menu", () => {
    const onCreateAnnotation = vi.fn();
    const { select, handle, menu, status } = setupWithStatus({
      onCreateAnnotation,
      renderSelectionMenu: () => <i data-testid="slot" />,
    });
    select();
    expect(handle().getPendingSelection()).toEqual(PENDING);

    status(LOADING);

    expect(handle().getPendingSelection()).toBeNull();
    expect(menu()).toBeNull();
    // Nothing of the old document is left to commit.
    handle().commitPendingSelection(CHOSEN);
    expect(onCreateAnnotation).not.toHaveBeenCalled();
  });

  test("a selection made once the next document is ready stays", () => {
    const { select, handle, status } = setupWithStatus({});
    status(LOADING);
    status(READY);
    select();
    // Progress and readiness reports do not clear it.
    status(READY);
    expect(handle().getPendingSelection()).toEqual(PENDING);
  });
});

test("nothing is rendered for a pending selection when no slot is given", () => {
  const { select, handle } = setup();
  select();
  expect(handle().getPendingSelection()).not.toBeNull();
  expect(document.body.querySelector(MENU)).toBeNull();
});

test("removing the slot while a selection is pending removes the menu and keeps the selection", () => {
  const common = { renderSelectionMenu: () => <i /> };
  const { select, menu, handle, rerender } = setup(common);
  select();
  expect(menu()).not.toBeNull();

  rerender({});
  expect(menu()).toBeNull();
  expect(handle().getPendingSelection()).toEqual(PENDING);
});

test("two annotators share neither the pending selection nor the callbacks", () => {
  const firstCreate = vi.fn();
  const secondCreate = vi.fn();
  const first = setup({ onCreateAnnotation: firstCreate });
  const second = setup({ onCreateAnnotation: secondCreate });

  first.select();
  expect(first.handle().getPendingSelection()).toEqual(PENDING);
  expect(second.handle().getPendingSelection()).toBeNull();

  second.select();
  act(() => second.handle().commitPendingSelection());
  expect(secondCreate).toHaveBeenCalledTimes(1);
  expect(firstCreate).not.toHaveBeenCalled();
  expect(first.handle().getPendingSelection()).toEqual(PENDING);
});

test("the library never adds the draft to annotations", () => {
  const onCreateAnnotation = vi.fn();
  let count = -1;
  function Count() {
    const store = useAnnotatorStore("Count");
    count = useAtomValue(annotationsAtom, { store }).length;
    return null;
  }
  const handleRef = createRef<AnnotatorHandle>();
  render(
    <AnnotatorShell
      common={{
        annotations: [annotation("a1")],
        onCreateAnnotation,
        activeLabel: ACTIVE,
      }}
      handleRef={handleRef}
    >
      <Count />
      <Completer />
    </AnnotatorShell>
  );
  expect(count).toBe(1);

  fireEvent.click(document.body.querySelector("[data-completer]")!);

  expect(onCreateAnnotation).toHaveBeenCalledTimes(1);
  expect(count).toBe(1);
});

describe("selection menu host", () => {
  test("is a fixed-position element portalled to document.body, placed with clampMenuPosition", () => {
    const { select, menu, root } = setup({ renderSelectionMenu: () => <i /> });
    select();

    const host = menu()!;
    expect(host.parentElement).toBe(document.body);
    expect(root.contains(host)).toBe(false);
    expect(host.style.position).toBe("fixed");
    // The anchor plus the default offset, inside the jsdom viewport.
    expect(host.style.left).toBe("110px");
    expect(host.style.top).toBe("130px");
  });

  test("is portalled to the body of the annotator's own document", () => {
    const frame = document.createElement("iframe");
    document.body.append(frame);
    const frameDocument = frame.contentDocument!;
    const container = frameDocument.createElement("div");
    frameDocument.body.append(container);
    try {
      const view = render(
        <FakeAnnotator
          common={{ annotations: [], renderSelectionMenu: () => <i /> }}
          fake={{ recorder: createRecorder() }}
          handleRef={null}
        />,
        { container }
      );
      fireEvent.click(container.querySelector("[data-fake-select]")!);

      expect(frameDocument.body.querySelector(MENU)?.parentElement).toBe(
        frameDocument.body
      );
      expect(document.body.querySelector(MENU)).toBeNull();
      view.unmount();
    } finally {
      frame.remove();
    }
  });

  test("flips to stay inside the viewport", () => {
    const { select, recorder, menu } = setup({
      renderSelectionMenu: () => <i />,
    });
    select();
    act(() =>
      recorder.completeSelection(FAKE_DRAFT, {
        x: window.innerWidth - 4,
        y: window.innerHeight - 4,
      })
    );

    const host = menu()!;
    expect(parseFloat(host.style.left)).toBeLessThan(window.innerWidth - 4);
    expect(parseFloat(host.style.top)).toBeLessThan(window.innerHeight - 4);
    expect(parseFloat(host.style.left) + 200).toBeLessThanOrEqual(
      window.innerWidth
    );
    expect(parseFloat(host.style.top) + 200).toBeLessThanOrEqual(
      window.innerHeight
    );
  });

  test("carries the root's --rca-z-menu to the portalled host, defaulting to 9999", () => {
    const first = setup({ renderSelectionMenu: () => <i /> });
    first.select();
    const defaulted = first.menu()!;
    expect(defaulted.style.getPropertyValue("--rca-z-menu")).toBe("9999");
    expect(defaulted.style.zIndex).toBe("var(--rca-z-menu, 9999)");
    act(() => first.handle().clearPendingSelection());

    const second = setup({
      renderSelectionMenu: () => <i />,
      style: { ["--rca-z-menu" as string]: "12345" },
    });
    second.select();
    expect(second.menu()!.style.getPropertyValue("--rca-z-menu")).toBe(
      "12345"
    );
  });

  test("mousedown and touchstart inside the menu do not propagate", () => {
    const outside = vi.fn();
    window.addEventListener("mousedown", outside);
    window.addEventListener("touchstart", outside);
    try {
      const { select, menu, root } = setup({
        renderSelectionMenu: () => <b data-testid="inner" />,
      });
      select();
      const inner = menu()!.querySelector("[data-testid=inner]")!;

      fireEvent.mouseDown(inner);
      fireEvent.touchStart(inner);
      expect(outside).not.toHaveBeenCalled();

      // Control: the same events elsewhere do reach the window.
      fireEvent.mouseDown(root);
      fireEvent.touchStart(root);
      expect(outside).toHaveBeenCalledTimes(2);
    } finally {
      window.removeEventListener("mousedown", outside);
      window.removeEventListener("touchstart", outside);
    }
  });
});

describe("hooks", () => {
  function twoHooks() {
    const seen: {
      pending?: PendingSelection | null;
      actions?: ReturnType<typeof usePendingActions>;
      renders: number;
    } = { renders: 0 };
    function Probe() {
      seen.renders += 1;
      seen.pending = usePendingSelection();
      seen.actions = usePendingActions();
      return null;
    }
    const onCreateAnnotation = vi.fn();
    const handleRef = createRef<AnnotatorHandle>();
    const view = render(
      <AnnotatorShell
        common={{ annotations: [], onCreateAnnotation }}
        handleRef={handleRef}
      >
        <Probe />
        <Completer />
      </AnnotatorShell>
    );
    return {
      seen,
      onCreateAnnotation,
      handle: () => handleRef.current!,
      select: () =>
        fireEvent.click(view.container.querySelector("[data-completer]")!),
    };
  }

  test("usePendingSelection follows the pending selection", () => {
    const { seen, select, handle } = twoHooks();
    expect(seen.pending).toBeNull();

    select();
    expect(seen.pending).toEqual(PENDING);

    act(() => handle().clearPendingSelection());
    expect(seen.pending).toBeNull();
  });

  test("usePendingActions are stable and act on the current selection", () => {
    const { seen, select, onCreateAnnotation } = twoHooks();
    const actions = seen.actions!;

    select();
    expect(seen.actions).toBe(actions);

    act(() => actions.commit(CHOSEN));
    expect(onCreateAnnotation).toHaveBeenCalledWith({
      ...DRAFT,
      annotationLabel: CHOSEN,
    });
    expect(seen.pending).toBeNull();

    // With nothing pending they do nothing and do not throw.
    expect(() => act(() => actions.commit())).not.toThrow();
    expect(() => act(() => actions.clear())).not.toThrow();
    expect(onCreateAnnotation).toHaveBeenCalledTimes(1);
  });

  test("useCompleteSelection is stable and does not subscribe to the selection", () => {
    const completions: ReturnType<typeof useCompleteSelection>[] = [];
    let renders = 0;
    function Formatter() {
      renders += 1;
      completions.push(useCompleteSelection());
      return null;
    }
    const handleRef = createRef<AnnotatorHandle>();
    const view = render(
      <AnnotatorShell common={{ annotations: [] }} handleRef={handleRef}>
        <Formatter />
      </AnnotatorShell>
    );
    const rendersBefore = renders;

    act(() => completions[0](FAKE_DRAFT, FAKE_ANCHOR));
    expect(handleRef.current!.getPendingSelection()).toEqual(PENDING);
    expect(renders).toBe(rendersBefore);

    view.rerender(
      <AnnotatorShell common={{ annotations: [] }} handleRef={handleRef}>
        <Formatter />
      </AnnotatorShell>
    );
    expect(new Set(completions).size).toBe(1);
  });

  const HOOKS: [string, () => unknown][] = [
    ["useCompleteSelection", () => useCompleteSelection()],
    ["usePendingSelection", () => usePendingSelection()],
    ["usePendingActions", () => usePendingActions()],
  ];

  test.each(HOOKS)("%s throws outside an annotator", (name, hook) => {
    // React re-throws a render error through a window "error" event (which
    // jsdom would print) and then logs it; keep the test output clean.
    const swallow = (event: ErrorEvent) => event.preventDefault();
    window.addEventListener("error", swallow);
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    try {
      expect(() => renderHook(hook)).toThrow(
        `${name} must be used inside an annotator`
      );
    } finally {
      consoleError.mockRestore();
      window.removeEventListener("error", swallow);
    }
  });
});
