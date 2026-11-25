import { act, render } from "@testing-library/react";
import { createRef, StrictMode, useState } from "react";

import type { AnnotatorCommonProps, AnnotatorHandle } from "../types";
import {
  FakeAnnotator,
  LOADING,
  READY,
  annotation,
  createRecorder,
  highlight,
} from "./fakeFormat";
import type { FakeFormatProps, FakeRecorder } from "./fakeFormat";

const USER = { source: "user" } as const;
const ANNOTATIONS = [annotation("a1"), annotation("a2"), annotation("a3")];
const HIGHLIGHTS = [highlight("h1"), highlight("h2")];

function setup(
  common: Partial<AnnotatorCommonProps> = {},
  fake: Partial<FakeFormatProps> = {},
  { strict = false } = {}
) {
  const handleRef = createRef<AnnotatorHandle>();
  const recorder = createRecorder();
  const element = (
    nextCommon: Partial<AnnotatorCommonProps>,
    nextFake: Partial<FakeFormatProps>
  ) => {
    const annotator = (
      <FakeAnnotator
        common={{ annotations: ANNOTATIONS, ...nextCommon }}
        fake={{ recorder, ...nextFake }}
        handleRef={handleRef}
      />
    );
    return strict ? <StrictMode>{annotator}</StrictMode> : annotator;
  };
  const view = render(element(common, fake));
  return {
    handle: () => handleRef.current!,
    recorder,
    rerender(
      nextCommon: Partial<AnnotatorCommonProps> = common,
      nextFake: Partial<FakeFormatProps> = fake
    ) {
      view.rerender(element(nextCommon, nextFake));
    },
  };
}

/** The targets of the requests the format saw. */
const targets = (recorder: FakeRecorder) =>
  recorder.requests.map((request) => request.target);

/** Observes a promise without awaiting it. */
function track(promise: Promise<boolean>) {
  const state: { settled: boolean; value?: boolean } = { settled: false };
  void promise.then((value) => {
    state.settled = true;
    state.value = value;
  });
  return state;
}

afterEach(() => {
  vi.useRealTimers();
});

test("selection changed by props raises a scroll request for the first id", () => {
  const { recorder, rerender } = setup({ selectedAnnotationIds: [] });
  expect(recorder.requests).toEqual([]);

  rerender({ selectedAnnotationIds: ["a2", "a1"] });

  expect(recorder.requests).toEqual([
    {
      seq: 1,
      target: { kind: "annotation", id: "a2" },
      behavior: "smooth",
      bounded: false,
    },
  ]);
});

test("selection changed by handle.selectAnnotations raises one; {scroll:false} does not", () => {
  const { handle, recorder } = setup();

  act(() => handle().selectAnnotations(["a1"]));
  expect(targets(recorder)).toEqual([{ kind: "annotation", id: "a1" }]);

  act(() => handle().selectAnnotations(["a2"], { scroll: false }));
  expect(handle().getSelectedAnnotationIds()).toEqual(["a2"]);
  expect(recorder.requests).toHaveLength(1);

  // The quiet write is used up: the next change scrolls again.
  act(() => handle().selectAnnotations(["a3"]));
  expect(targets(recorder)).toEqual([
    { kind: "annotation", id: "a1" },
    { kind: "annotation", id: "a3" },
  ]);
});

/** A host controlling the selection, echoing each change as a new array. */
function EchoHost({
  recorder,
  expose,
}: {
  recorder: FakeRecorder;
  expose: (api: {
    setIds: (ids: string[]) => void;
    handle: () => AnnotatorHandle;
  }) => void;
}) {
  const [ids, setIds] = useState<string[]>([]);
  const handleRef = createRef<AnnotatorHandle>();
  expose({ setIds, handle: () => handleRef.current! });
  return (
    <FakeAnnotator
      common={{
        annotations: ANNOTATIONS,
        selectedAnnotationIds: ids,
        onSelectionChange: (next) => setIds([...next]),
      }}
      fake={{ recorder }}
      handleRef={handleRef}
    />
  );
}

function renderEchoHost() {
  const recorder = createRecorder();
  let api!: Parameters<Parameters<typeof EchoHost>[0]["expose"]>[0];
  render(<EchoHost recorder={recorder} expose={(next) => (api = next)} />);
  return { recorder, api: () => api };
}

test("controlled: {scroll:false} holds when the host echoes the change back", () => {
  const { recorder, api } = renderEchoHost();
  act(() => api().handle().selectAnnotations(["a1"], { scroll: false }));
  expect(api().handle().getSelectedAnnotationIds()).toEqual(["a1"]);
  expect(recorder.requests).toEqual([]);
});

test("user-sourced selection does not raise one, uncontrolled", () => {
  const { handle, recorder } = setup();

  act(() => recorder.write("selection", ["a1"], USER));

  expect(handle().getSelectedAnnotationIds()).toEqual(["a1"]);
  expect(recorder.requests).toEqual([]);
});

test("after a user selection, a later api selection of the same ids still raises one", () => {
  const { handle, recorder } = setup();
  act(() => recorder.write("selection", ["a1"], USER));
  act(() => handle().selectAnnotations(["a2"]));
  act(() => handle().selectAnnotations(["a1"]));
  expect(targets(recorder)).toEqual([
    { kind: "annotation", id: "a2" },
    { kind: "annotation", id: "a1" },
  ]);
});

test("user-sourced selection does not raise one when the host echoes it back as a prop", () => {
  const { recorder, api } = renderEchoHost();

  act(() => recorder.write("selection", ["a1"], USER));
  expect(api().handle().getSelectedAnnotationIds()).toEqual(["a1"]);
  expect(recorder.requests).toEqual([]);

  // A host-side change is not an echo, and neither is a later return to
  // the ids the user once picked.
  act(() => api().setIds(["a2"]));
  act(() => api().setIds(["a1"]));
  expect(targets(recorder)).toEqual([
    { kind: "annotation", id: "a2" },
    { kind: "annotation", id: "a1" },
  ]);

  // Repeating the user's own pick is again an echo.
  act(() => recorder.write("selection", ["a3"], USER));
  expect(recorder.requests).toHaveLength(2);
});

test("scrollOnSelect=false suppresses selection-driven requests but not handle.scrollToAnnotation", () => {
  const common = { scrollOnSelect: false };
  const { handle, recorder, rerender } = setup({
    ...common,
    selectedAnnotationIds: [],
  });

  rerender({ ...common, selectedAnnotationIds: ["a1"] });
  rerender({ ...common, selectedAnnotationIds: ["a1", "a2"] });
  expect(recorder.requests).toEqual([]);

  rerender({ ...common });
  act(() => handle().selectAnnotations(["a3"]));
  expect(recorder.requests).toEqual([]);

  act(() => {
    void handle().scrollToAnnotation("a2");
  });
  expect(recorder.requests).toEqual([
    {
      seq: 1,
      target: { kind: "annotation", id: "a2" },
      behavior: "smooth",
      bounded: true,
    },
  ]);
});

test("selection present at mount raises one request once documentStatus is 'ready'", () => {
  const common = { defaultSelectedAnnotationIds: ["a2"] };
  const { recorder, rerender } = setup(common, { status: LOADING });
  expect(recorder.requests).toEqual([]);

  rerender(common, { status: READY });
  expect(recorder.requests).toEqual([
    {
      seq: 1,
      target: { kind: "annotation", id: "a2" },
      behavior: "smooth",
      bounded: false,
    },
  ]);

  // Further renders do not raise it again.
  rerender({ ...common, annotations: [...ANNOTATIONS] }, { status: READY });
  expect(recorder.requests).toHaveLength(1);
});

test("scrollOnSelect=false also suppresses the selection present at load; highlight and handle requests are unaffected", () => {
  const common = {
    scrollOnSelect: false,
    selectedAnnotationIds: ["a2"],
    highlights: HIGHLIGHTS,
    activeHighlightId: "h1",
  };
  const { handle, recorder, rerender } = setup(common, { status: LOADING });
  rerender(common, { status: READY });
  expect(recorder.requests.map((r) => [r.target, r.bounded])).toEqual([
    [{ kind: "highlight", id: "h1" }, false],
  ]);

  act(() => {
    void handle().scrollToAnnotation("a2");
  });
  expect(recorder.requests.map((r) => [r.target, r.bounded])).toEqual([
    [{ kind: "highlight", id: "h1" }, false],
    [{ kind: "annotation", id: "a2" }, true],
  ]);
});

test("selection present at mount raises its request under StrictMode too", () => {
  const common = { defaultSelectedAnnotationIds: ["a2"] };
  const { recorder, rerender } = setup(
    common,
    { status: LOADING },
    { strict: true }
  );
  rerender(common, { status: READY });
  expect(targets(recorder)).toEqual([{ kind: "annotation", id: "a2" }]);
});

test("…and waits for the id to appear in annotations", () => {
  const common = { defaultSelectedAnnotationIds: ["a9"] };
  const { recorder, rerender } = setup(common);
  expect(recorder.requests).toEqual([]);

  rerender({ ...common, annotations: [...ANNOTATIONS] });
  expect(recorder.requests).toEqual([]);

  rerender({ ...common, annotations: [...ANNOTATIONS, annotation("a9")] });
  expect(targets(recorder)).toEqual([{ kind: "annotation", id: "a9" }]);
});

test("zoom change raises none; new annotations array with same content raises none", () => {
  const { handle, recorder, rerender } = setup({
    selectedAnnotationIds: ["a1"],
  });
  expect(recorder.requests).toHaveLength(1);

  act(() => handle().zoomIn());
  act(() => handle().setZoom(2));
  act(() => recorder.write("zoom", 3, USER));
  expect(handle().getZoom()).toBe(3);

  rerender({ selectedAnnotationIds: ["a1"], annotations: [...ANNOTATIONS] });
  rerender({
    selectedAnnotationIds: ["a1"],
    annotations: ANNOTATIONS.map((a) => ({ ...a })),
  });
  // Nor does the selected annotation leaving the data and coming back.
  rerender({
    selectedAnnotationIds: ["a1"],
    annotations: ANNOTATIONS.slice(1),
  });
  rerender({ selectedAnnotationIds: ["a1"], annotations: ANNOTATIONS });
  expect(recorder.requests).toHaveLength(1);
});

test("active highlight changed by props raises a highlight request", () => {
  const { recorder, rerender } = setup({
    highlights: HIGHLIGHTS,
    activeHighlightId: null,
  });
  expect(recorder.requests).toEqual([]);

  rerender({ highlights: HIGHLIGHTS, activeHighlightId: "h2" });

  expect(recorder.requests).toEqual([
    {
      seq: 1,
      target: { kind: "highlight", id: "h2" },
      behavior: "smooth",
      bounded: false,
    },
  ]);
});

test("active highlight changed by the handle raises one; a user change does not", () => {
  const { handle, recorder } = setup({ highlights: HIGHLIGHTS });

  act(() => recorder.write("activeHighlight", "h1", USER));
  expect(recorder.requests).toEqual([]);

  // scrollToHighlight's own bounded request is the only one raised.
  act(() => {
    void handle().scrollToHighlight("h2", { activate: true });
  });
  expect(recorder.requests.map((r) => [r.target, r.bounded])).toEqual([
    [{ kind: "highlight", id: "h2" }, true],
  ]);
});

test("a repeated user pick of the same highlight is still an echo", () => {
  const { handle, recorder } = setup({ highlights: HIGHLIGHTS });
  act(() => recorder.write("activeHighlight", "h1", USER));
  act(() => {
    void handle().scrollToHighlight("h2", { activate: true });
  });
  act(() => recorder.write("activeHighlight", "h1", USER));
  expect(targets(recorder)).toEqual([{ kind: "highlight", id: "h2" }]);
});

test("a newer request settles the older promise false", async () => {
  vi.useFakeTimers();
  const { handle } = setup({}, { autoComplete: false });

  let first!: ReturnType<typeof track>;
  let second!: ReturnType<typeof track>;
  act(() => {
    first = track(handle().scrollToAnnotation("a1"));
  });
  await act(async () => {
    second = track(handle().scrollToAnnotation("a2"));
  });

  expect(first).toEqual({ settled: true, value: false });
  expect(second).toEqual({ settled: false });
});

test("bounded request settles false after 5000 ms when never completed", async () => {
  vi.useFakeTimers();
  const { handle, recorder } = setup({}, { autoComplete: false });

  let pending!: ReturnType<typeof track>;
  act(() => {
    pending = track(handle().scrollToAnnotation("a1"));
  });
  expect(recorder.requests).toHaveLength(1);

  await act(async () => {
    vi.advanceTimersByTime(4999);
  });
  expect(pending.settled).toBe(false);

  await act(async () => {
    vi.advanceTimersByTime(1);
  });
  expect(pending).toEqual({ settled: true, value: false });
  expect(recorder.current).toBeNull();
});

test("an unbounded request waits past the bounded timeout", async () => {
  vi.useFakeTimers();
  const { recorder, rerender } = setup(
    { selectedAnnotationIds: [] },
    { autoComplete: false }
  );
  rerender({ selectedAnnotationIds: ["a1"] });
  expect(recorder.current?.bounded).toBe(false);

  await act(async () => {
    vi.advanceTimersByTime(60_000);
  });
  expect(recorder.current?.target).toEqual({ kind: "annotation", id: "a1" });
});

test("a scrollToPage that scrolls settles a pending request false", async () => {
  const { handle } = setup({}, { autoComplete: false });
  let pending!: ReturnType<typeof track>;
  act(() => {
    pending = track(handle().scrollToAnnotation("a1"));
  });

  await act(async () => {
    expect(handle().scrollToPage(9)).toBe(false);
  });
  expect(pending.settled).toBe(false);

  await act(async () => {
    expect(handle().scrollToPage(1)).toBe(true);
  });
  expect(pending).toEqual({ settled: true, value: false });
});

test("unmounting settles a pending request false", async () => {
  const handleRef = createRef<AnnotatorHandle>();
  const recorder = createRecorder();
  const view = render(
    <FakeAnnotator
      common={{ annotations: ANNOTATIONS }}
      fake={{ recorder, autoComplete: false }}
      handleRef={handleRef}
    />
  );
  let pending!: ReturnType<typeof track>;
  act(() => {
    pending = track(handleRef.current!.scrollToAnnotation("a1"));
  });

  view.unmount();
  await Promise.resolve();

  expect(pending).toEqual({ settled: true, value: false });
});
