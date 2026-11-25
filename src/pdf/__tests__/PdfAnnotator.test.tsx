import { act, render, screen } from "@testing-library/react";
import { createRef, useEffect, useRef } from "react";

import type {
  AnnotatorHandle,
  Highlight,
  PdfDocumentProxyLike,
} from "../../core/index";
import { PdfAnnotator } from "../index";
import {
  fakeDocument,
  fakePage,
  fakePdfjs,
  flushPromises,
} from "./pdfjsFake";

vi.mock("pdfjs-dist/legacy/build/pdf.mjs", async () => {
  const { fakePdfjs: fake } = await import("./pdfjsFake");
  return { getDocument: fake.getDocument, GlobalWorkerOptions: {} };
});

beforeEach(() => {
  fakePdfjs.reset();
});

afterEach(() => {
  vi.restoreAllMocks();
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

/** A fake document whose pages render (to nothing) on a canvas. */
function renderableDocument(numPages: number): PdfDocumentProxyLike {
  const document = fakeDocument(numPages);
  document.getPage.mockImplementation(async (pageNumber: number) => ({
    ...fakePage(pageNumber),
    render: () => ({ promise: Promise.resolve(), cancel: () => {} }),
  }));
  return document as unknown as PdfDocumentProxyLike;
}

const SOURCE = { document: renderableDocument(2) };
const ON_PAGE_0: Highlight = {
  id: "h1",
  target: {
    kind: "bounds",
    boundsByPage: { 0: { left: 10, top: 10, right: 50, bottom: 20 } },
  },
};

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
    <PdfAnnotator
      ref={handleRef}
      source={SOURCE}
      annotations={[]}
      highlights={highlights}
      onActiveHighlightChange={onActiveHighlightChange}
      enableNativeLinks={false}
    />
  );
}

test("a jump from an effect of the commit that supplies the highlight finds it", async () => {
  // jsdom has no 2D canvas (the fake pages draw nothing on it anyway), lays
  // nothing out and cannot scroll.
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
    {} as CanvasRenderingContext2D
  );
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  Element.prototype.scrollIntoView = vi.fn();
  const onActiveHighlightChange = vi.fn();
  const jumps: Promise<boolean>[] = [];
  const onJump = (result: Promise<boolean>) => jumps.push(result);
  const view = render(
    <JumpingHost
      highlights={[]}
      onActiveHighlightChange={onActiveHighlightChange}
      onJump={onJump}
    />
  );
  await act(async () => {
    await flushPromises();
  });

  view.rerender(
    <JumpingHost
      highlights={[ON_PAGE_0]}
      onActiveHighlightChange={onActiveHighlightChange}
      onJump={onJump}
    />
  );

  expect(jumps).toHaveLength(1);
  // The target was known: the jump is under way rather than refused, and it
  // activated the highlight.
  const settled = await Promise.race([
    jumps[0].then((scrolled) => (scrolled ? "scrolled" : "refused")),
    flushPromises().then(() => "under way"),
  ]);
  expect(settled).not.toBe("refused");
  expect(onActiveHighlightChange.mock.calls).toEqual([["h1"]]);
  view.unmount();
  delete (Element.prototype as Partial<Element>).scrollIntoView;
});
