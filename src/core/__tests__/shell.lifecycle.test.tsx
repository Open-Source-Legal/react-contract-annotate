import { render } from "@testing-library/react";
import { createRef, useLayoutEffect } from "react";

import { AnnotatorShell } from "../AnnotatorShell";
import { useSetDocumentStatus } from "../formatHooks";
import type { DocumentStatusUpdate } from "../formatHooks";
import type { AnnotatorCommonProps, AnnotatorHandle } from "../types";
import {
  FAKE_PAGE_COUNT,
  FAKE_TEXT,
  FakeAnnotator,
  FakeFormat,
  LOADING,
  READY,
  annotation,
  createRecorder,
} from "./fakeFormat";
import type { FakeStatus } from "./fakeFormat";

const ANNOTATIONS = [annotation("a1")];
const LOADED = { pageCount: FAKE_PAGE_COUNT, text: FAKE_TEXT };

function setup(common: Partial<AnnotatorCommonProps>, status: FakeStatus) {
  const handleRef = createRef<AnnotatorHandle>();
  const recorder = createRecorder();
  const element = (
    nextCommon: Partial<AnnotatorCommonProps>,
    nextStatus: FakeStatus
  ) => (
    <FakeAnnotator
      common={{ annotations: ANNOTATIONS, ...nextCommon }}
      fake={{ recorder, status: nextStatus }}
      handleRef={handleRef}
    />
  );
  const view = render(element(common, status));
  return {
    rerender: (nextCommon: Partial<AnnotatorCommonProps>, next: FakeStatus) =>
      view.rerender(element(nextCommon, next)),
  };
}

test("onDocumentLoad fires once on ready with the driver's page count and text", () => {
  const onDocumentLoad = vi.fn();
  const { rerender } = setup({ onDocumentLoad }, LOADING);
  expect(onDocumentLoad).not.toHaveBeenCalled();

  rerender({ onDocumentLoad }, READY);
  expect(onDocumentLoad.mock.calls).toEqual([[LOADED]]);
});

test("a re-render with new inline callbacks does not fire them again", () => {
  const first = { onDocumentLoad: vi.fn(), onError: vi.fn() };
  const { rerender } = setup(first, READY);
  expect(first.onDocumentLoad).toHaveBeenCalledTimes(1);

  const second = { onDocumentLoad: vi.fn(), onError: vi.fn() };
  rerender(second, READY);
  rerender({ ...second, annotations: [...ANNOTATIONS] }, READY);

  expect(first.onDocumentLoad).toHaveBeenCalledTimes(1);
  expect(second.onDocumentLoad).not.toHaveBeenCalled();
  expect(second.onError).not.toHaveBeenCalled();
});

test("onDocumentLoad fires again after loading -> ready", () => {
  const onDocumentLoad = vi.fn();
  const { rerender } = setup({ onDocumentLoad }, READY);
  rerender({ onDocumentLoad }, LOADING);
  rerender({ onDocumentLoad }, READY);
  expect(onDocumentLoad.mock.calls).toEqual([[LOADED], [LOADED]]);
});

test("onError fires once per transition to error", () => {
  const onError = vi.fn();
  const onDocumentLoad = vi.fn();
  const boom = new Error("boom");
  const failed: FakeStatus = { state: "error", progress: null, error: boom };
  const { rerender } = setup({ onError, onDocumentLoad }, LOADING);

  rerender({ onError, onDocumentLoad }, failed);
  rerender({ onError: () => {}, onDocumentLoad }, failed);
  // A different error while still failed is not a new transition.
  rerender(
    { onError, onDocumentLoad },
    { state: "error", progress: null, error: new Error("again") }
  );
  expect(onError.mock.calls).toEqual([[boom]]);

  rerender({ onError, onDocumentLoad }, LOADING);
  rerender({ onError, onDocumentLoad }, failed);
  expect(onError.mock.calls).toEqual([[boom], [boom]]);
  expect(onDocumentLoad).not.toHaveBeenCalled();
});

test("nothing fires while loading", () => {
  const onDocumentLoad = vi.fn();
  const onError = vi.fn();
  const { rerender } = setup({ onDocumentLoad, onError }, LOADING);
  rerender(
    { onDocumentLoad, onError },
    { state: "loading", progress: 40, error: null }
  );
  rerender(
    { onDocumentLoad, onError },
    { state: "loading", progress: 90, error: null }
  );
  expect(onDocumentLoad).not.toHaveBeenCalled();
  expect(onError).not.toHaveBeenCalled();
});

/** Reports a status without registering a driver. */
function StatusReporter({ status }: { status: DocumentStatusUpdate }) {
  const setStatus = useSetDocumentStatus();
  useLayoutEffect(() => setStatus(status), [setStatus, status]);
  return null;
}

test("a status that is ready before any driver registers fires when one does", () => {
  const onDocumentLoad = vi.fn();
  const handleRef = createRef<AnnotatorHandle>();
  const recorder = createRecorder();
  const common = { annotations: ANNOTATIONS, onDocumentLoad };

  const view = render(
    <AnnotatorShell common={common} handleRef={handleRef}>
      <StatusReporter status={READY} />
    </AnnotatorShell>
  );
  expect(onDocumentLoad).not.toHaveBeenCalled();

  view.rerender(
    <AnnotatorShell common={common} handleRef={handleRef}>
      <StatusReporter status={READY} />
      <FakeFormat recorder={recorder} />
    </AnnotatorShell>
  );
  expect(onDocumentLoad.mock.calls).toEqual([[LOADED]]);
});

test("a format remounting while the document stays ready does not fire again", () => {
  const onDocumentLoad = vi.fn();
  const handleRef = createRef<AnnotatorHandle>();
  const recorder = createRecorder();
  const common = { annotations: ANNOTATIONS, onDocumentLoad };
  const view = render(
    <AnnotatorShell common={common} handleRef={handleRef}>
      <FakeFormat key="first" recorder={recorder} />
    </AnnotatorShell>
  );
  view.rerender(
    <AnnotatorShell common={common} handleRef={handleRef}>
      <FakeFormat key="second" recorder={recorder} />
    </AnnotatorShell>
  );
  expect(onDocumentLoad).toHaveBeenCalledTimes(1);
});
