import { act, render } from "@testing-library/react";
import { StrictMode, createRef, useEffect } from "react";
import type { ReactElement } from "react";

import { AnnotatorShell, useDocumentStatus } from "../../core/index";
import type {
  AnnotatorHandle,
  CompactPawls,
  DocumentStatus,
  PawlsInput,
  PawlsPage,
  PdfAnnotatorProps,
  PdfDocumentProxyLike,
} from "../../core/index";
import { usePdfDocument } from "../loader";
import type { PDFPageInfo } from "../PDFPageInfo";
import {
  FAKE_VIEWPORT,
  fakeDocument,
  fakePdfjs,
  flushPromises,
} from "./pdfjsFake";
import type { FakeDocument, FakeLoadingTask } from "./pdfjsFake";

vi.mock("pdfjs-dist/legacy/build/pdf.mjs", async () => {
  const { fakePdfjs: fake } = await import("./pdfjsFake");
  return { getDocument: fake.getDocument, GlobalWorkerOptions: {} };
});

type Source = PdfAnnotatorProps["source"];

/** PAWLs measured on a page of a different size than pdf.js reports. */
const PAWLS_SIZE = Object.freeze({ width: 612, height: 792 });

function pawlsPage(index: number, text: string): PawlsPage {
  return {
    page: { ...PAWLS_SIZE, index },
    tokens: [{ x: 100, y: 200, width: 50, height: 10, text }],
  };
}

const TWO_PAGE_PAWLS: PawlsPage[] = [
  pawlsPage(0, "first"),
  pawlsPage(1, "second"),
];

type Log = { statuses: DocumentStatus[]; pages: PDFPageInfo[] };

function Probe({
  source,
  pawls,
  log,
}: {
  source: Source;
  pawls: PawlsInput | null | undefined;
  log: Log;
}) {
  const pages = usePdfDocument(source, pawls);
  const status = useDocumentStatus();
  useEffect(() => {
    log.statuses.push(status);
  }, [log, status]);
  useEffect(() => {
    log.pages = pages;
  }, [log, pages]);
  return null;
}

function setup(
  source: Source,
  pawls: PawlsInput | null | undefined = TWO_PAGE_PAWLS,
  { strict = false }: { strict?: boolean } = {}
) {
  const log: Log = { statuses: [], pages: [] };
  const handleRef = createRef<AnnotatorHandle>();
  const element = (nextSource: Source, nextPawls: typeof pawls) => {
    const tree: ReactElement = (
      <AnnotatorShell common={{ annotations: [] }} handleRef={handleRef}>
        <Probe source={nextSource} pawls={nextPawls} log={log} />
      </AnnotatorShell>
    );
    return strict ? <StrictMode>{tree}</StrictMode> : tree;
  };
  const view = render(element(source, pawls));
  return {
    log,
    rerender: (nextSource: Source, nextPawls: typeof pawls = pawls) =>
      view.rerender(element(nextSource, nextPawls)),
    unmount: () => view.unmount(),
  };
}

/** Resolves `task` with `document` and lets the load finish. */
async function resolveTask(task: FakeLoadingTask, document: FakeDocument) {
  await act(async () => {
    task.resolve(document);
    await flushPromises();
  });
}

async function settle() {
  await act(async () => {
    await flushPromises();
  });
}

const states = (log: Log) => log.statuses.map((s) => s.state);
const progresses = (log: Log) => log.statuses.map((s) => s.progress);

beforeEach(() => {
  fakePdfjs.reset();
});

test("status goes loading -> ready and pages are built with normalised tokens", async () => {
  const { log } = setup({
    url: "/doc.pdf",
    httpHeaders: { Authorization: "token" },
    withCredentials: true,
  });
  expect(fakePdfjs.getDocument).toHaveBeenCalledTimes(1);
  expect(fakePdfjs.tasks[0].params).toEqual({
    url: "/doc.pdf",
    httpHeaders: { Authorization: "token" },
    withCredentials: true,
  });
  expect(states(log)).toEqual(["loading"]);

  await resolveTask(fakePdfjs.tasks[0], fakeDocument(2));

  expect(states(log)).toEqual(["loading", "ready"]);
  expect(log.pages.map((p) => p.page.pageNumber)).toEqual([1, 2]);
  // PAWLs measured the page at 612 x 792; pdf.js reports 595 x 842, so the
  // tokens are rescaled into pdf.js' coordinate space.
  const [token] = log.pages[0].tokens;
  expect(token.text).toBe("first");
  expect(token.x).toBeCloseTo((100 * FAKE_VIEWPORT.width) / PAWLS_SIZE.width);
  expect(token.y).toBeCloseTo((200 * FAKE_VIEWPORT.height) / PAWLS_SIZE.height);
  expect(token.width).toBeCloseTo((50 * FAKE_VIEWPORT.width) / PAWLS_SIZE.width);
  expect(log.pages[1].tokens[0].text).toBe("second");
});

test("progress is reported as 0..100 and null before the first progress event", async () => {
  const { log } = setup({ url: "/doc.pdf" });
  const [task] = fakePdfjs.tasks;
  expect(progresses(log)).toEqual([null]);

  await act(async () => task.progress(50, 200));
  await act(async () => task.progress(250, 200)); // more than announced
  await act(async () => task.progress(10, 0)); // length unknown

  expect(progresses(log)).toEqual([null, 25, 100, null]);
  expect(states(log)).toEqual(["loading", "loading", "loading", "loading"]);
});

test("source {document} skips getDocument", async () => {
  const document = fakeDocument(3);
  const { log, unmount } = setup({
    document: document as unknown as PdfDocumentProxyLike,
  });
  await settle();

  expect(fakePdfjs.getDocument).not.toHaveBeenCalled();
  expect(states(log)).toEqual(["loading", "ready"]);
  expect(log.pages).toHaveLength(3);

  unmount();
  // The host's document is the host's to destroy.
  expect(document.destroy).not.toHaveBeenCalled();
});

test("data source hands pdf.js a copy, so the host's bytes are never detached", async () => {
  const bytes = new Uint8Array([37, 80, 68, 70]);
  setup({ data: bytes });

  const passed = fakePdfjs.tasks[0].params.data as Uint8Array;
  expect(passed).toEqual(bytes);
  expect(passed.buffer).not.toBe(bytes.buffer);
});

test("compact v2 pawls are expanded", async () => {
  const compact: CompactPawls = {
    v: 2,
    p: [
      { w: FAKE_VIEWPORT.width, h: FAKE_VIEWPORT.height, t: [[10, 20, 30, 40, "alpha"]] },
      { w: FAKE_VIEWPORT.width, h: FAKE_VIEWPORT.height, t: [[1, 2, 3, 4, "beta"]] },
    ],
  };
  const { log } = setup({ url: "/doc.pdf" }, compact);
  await resolveTask(fakePdfjs.tasks[0], fakeDocument(2));

  expect(log.pages[0].tokens).toEqual([
    { x: 10, y: 20, width: 30, height: 40, text: "alpha" },
  ]);
  expect(log.pages[1].tokens).toEqual([
    { x: 1, y: 2, width: 3, height: 4, text: "beta" },
  ]);
});

test("pawls null: pages have empty token arrays", async () => {
  const warn = vi.spyOn(console, "warn");
  const { log } = setup({ url: "/doc.pdf" }, null);
  await resolveTask(fakePdfjs.tasks[0], fakeDocument(2));

  expect(states(log)).toEqual(["loading", "ready"]);
  expect(log.pages.map((p) => p.tokens)).toEqual([[], []]);
  expect(warn).not.toHaveBeenCalled();
  warn.mockRestore();
});

test("pawls shorter than the document: later pages have empty token arrays", async () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const { log } = setup({ url: "/doc.pdf" }, [pawlsPage(0, "only")]);
  await resolveTask(fakePdfjs.tasks[0], fakeDocument(3));

  expect(log.pages.map((p) => p.tokens.length)).toEqual([1, 0, 0]);
  // The OpenContracts diagnostic, once per page without PAWLs data.
  expect(warn).toHaveBeenCalledTimes(2);
  expect(warn.mock.calls[0][0]).toContain("Page 2: PAWLS data index out of bounds");
  warn.mockRestore();
});

test("changing source cancels the first load: its pages never appear and destroy() is called on its task", async () => {
  const { log, rerender } = setup({ url: "/first.pdf" });
  rerender({ url: "/second.pdf" });
  const [first, second] = fakePdfjs.tasks;

  expect(first.destroy).toHaveBeenCalledTimes(1);
  expect(second.destroy).not.toHaveBeenCalled();

  const firstDocument = fakeDocument(2);
  await resolveTask(first, firstDocument);
  expect(firstDocument.getPage).not.toHaveBeenCalled();
  expect(log.pages).toEqual([]);
  expect(states(log)).toEqual(["loading"]);

  await resolveTask(second, fakeDocument(5));
  expect(log.pages).toHaveLength(5);
  expect(states(log)).toEqual(["loading", "ready"]);
});

test("a new source after ready clears the pages and reports loading again", async () => {
  const { log, rerender } = setup({ url: "/first.pdf" });
  await resolveTask(fakePdfjs.tasks[0], fakeDocument(2));
  expect(log.pages).toHaveLength(2);

  rerender({ url: "/second.pdf" });
  await settle();
  expect(log.pages).toEqual([]);
  expect(states(log)).toEqual(["loading", "ready", "loading"]);
  expect(fakePdfjs.tasks[0].destroy).toHaveBeenCalledTimes(1);
});

test("returning to an earlier source loads it again instead of reusing its destroyed pages", async () => {
  const { log, rerender } = setup({ url: "/a.pdf" });
  await resolveTask(fakePdfjs.tasks[0], fakeDocument(2));
  rerender({ url: "/b.pdf" }); // never resolves
  await settle();
  rerender({ url: "/a.pdf" });
  await settle();

  expect(fakePdfjs.tasks[0].destroyed).toBe(true);
  expect(fakePdfjs.tasks).toHaveLength(3);
  expect(log.pages).toEqual([]);
  expect(states(log).at(-1)).toBe("loading");

  await resolveTask(fakePdfjs.tasks[2], fakeDocument(4));
  expect(log.pages).toHaveLength(4);
  expect(states(log)).toEqual(["loading", "ready", "loading", "ready"]);
});

test("returning to an earlier source with new pawls does not publish its destroyed pages", async () => {
  const { log, rerender } = setup({ url: "/a.pdf" });
  await resolveTask(fakePdfjs.tasks[0], fakeDocument(2));
  rerender({ url: "/b.pdf" }, null); // never resolves
  await settle();
  rerender({ url: "/a.pdf" }, [...TWO_PAGE_PAWLS]);
  await settle();

  expect(log.pages).toEqual([]);
  expect(states(log).at(-1)).toBe("loading");
});

test("pawls arriving with a new source wait for the new document", async () => {
  const { log, rerender } = setup({ url: "/first.pdf" }, null);
  await resolveTask(fakePdfjs.tasks[0], fakeDocument(2));

  rerender({ url: "/second.pdf" }, TWO_PAGE_PAWLS);
  await settle();
  // Not the first document's pages rebuilt with the new tokens.
  expect(log.pages).toEqual([]);
  expect(states(log)).toEqual(["loading", "ready", "loading"]);

  await resolveTask(fakePdfjs.tasks[1], fakeDocument(3));
  expect(log.pages).toHaveLength(3);
  expect(log.pages[1].tokens[0].text).toBe("second");
  expect(states(log)).toEqual(["loading", "ready", "loading", "ready"]);
});

test("unmount mid-load calls destroy() and sets no state", async () => {
  const error = vi.spyOn(console, "error");
  const { log, unmount } = setup({ url: "/doc.pdf" });
  const [task] = fakePdfjs.tasks;
  unmount();
  expect(task.destroy).toHaveBeenCalledTimes(1);

  const document = fakeDocument(2);
  task.progress(1, 2);
  task.resolve(document);
  await flushPromises();

  expect(document.getPage).not.toHaveBeenCalled();
  expect(states(log)).toEqual(["loading"]);
  expect(error).not.toHaveBeenCalled();
  error.mockRestore();
});

test("StrictMode double mount yields exactly one live document", async () => {
  const { log } = setup({ url: "/doc.pdf" }, TWO_PAGE_PAWLS, { strict: true });
  const { tasks } = fakePdfjs;
  expect(tasks).toHaveLength(2);
  expect(tasks.filter((t) => !t.destroyed)).toHaveLength(1);

  const [discarded, live] = tasks;
  const discardedDocument = fakeDocument(2);
  await resolveTask(discarded, discardedDocument);
  await resolveTask(live, fakeDocument(4));

  expect(discardedDocument.getPage).not.toHaveBeenCalled();
  expect(log.pages).toHaveLength(4);
  expect(states(log).at(-1)).toBe("ready");
});

test("a load failure sets status error exactly once", async () => {
  const { log } = setup({ url: "/doc.pdf" });
  const failure = new Error("Missing PDF");

  await act(async () => {
    fakePdfjs.tasks[0].reject(failure);
    await flushPromises();
  });

  expect(states(log)).toEqual(["loading", "error"]);
  expect(log.statuses[1].error).toBe(failure);
});

test("a new source object with the same url does not reload", async () => {
  const { log, rerender } = setup({ url: "/doc.pdf", httpHeaders: { a: "1" } });
  await resolveTask(fakePdfjs.tasks[0], fakeDocument(2));

  rerender({ url: "/doc.pdf", httpHeaders: { a: "1" } });
  await settle();

  expect(fakePdfjs.getDocument).toHaveBeenCalledTimes(1);
  expect(states(log)).toEqual(["loading", "ready"]);
});

test("new pawls rebuild the tokens without reloading or reporting loading", async () => {
  const { log, rerender } = setup({ url: "/doc.pdf" }, null);
  await resolveTask(fakePdfjs.tasks[0], fakeDocument(2));
  expect(log.pages[0].tokens).toEqual([]);

  rerender({ url: "/doc.pdf" }, TWO_PAGE_PAWLS);
  await settle();

  expect(fakePdfjs.getDocument).toHaveBeenCalledTimes(1);
  expect(log.pages[0].tokens[0].text).toBe("first");
  expect(states(log)).toEqual(["loading", "ready"]);
});
