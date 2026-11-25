import { act, render, screen } from "@testing-library/react";
import { createRef } from "react";

import type { AnnotatorHandle } from "../../core/index";
import { PdfAnnotator } from "../index";
import { fakePdfjs, flushPromises } from "./pdfjsFake";

vi.mock("pdfjs-dist/legacy/build/pdf.mjs", async () => {
  const { fakePdfjs: fake } = await import("./pdfjsFake");
  return { getDocument: fake.getDocument, GlobalWorkerOptions: {} };
});

beforeEach(() => {
  fakePdfjs.reset();
});

test("a load failure calls onError once and renders the error slot", async () => {
  const onError = vi.fn();
  const onDocumentLoad = vi.fn();
  const handleRef = createRef<AnnotatorHandle>();
  const view = render(
    <PdfAnnotator
      ref={handleRef}
      source={{ url: "/missing.pdf" }}
      annotations={[]}
      onError={onError}
      onDocumentLoad={onDocumentLoad}
      renderError={(error) => <p>failed: {error.message}</p>}
    />
  );
  const failure = new Error("Missing PDF");

  await act(async () => {
    fakePdfjs.tasks[0].reject(failure);
    await flushPromises();
  });
  // A re-render with new inline callbacks must not report it again.
  view.rerender(
    <PdfAnnotator
      ref={handleRef}
      source={{ url: "/missing.pdf" }}
      annotations={[]}
      onError={onError}
      onDocumentLoad={onDocumentLoad}
      renderError={(error) => <p>failed: {error.message}</p>}
    />
  );

  expect(onError.mock.calls).toEqual([[failure]]);
  expect(onDocumentLoad).not.toHaveBeenCalled();
  expect(screen.getByText("failed: Missing PDF")).toBeTruthy();
  expect(fakePdfjs.getDocument).toHaveBeenCalledTimes(1);
  expect(handleRef.current?.getPageCount()).toBeNull();
  expect(handleRef.current?.getVisiblePageRange()).toBeNull();
});
