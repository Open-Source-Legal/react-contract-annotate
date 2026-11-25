import { act, render } from "@testing-library/react";
import { StrictMode, createRef, useEffect } from "react";
import type { ReactElement } from "react";

import { AnnotatorShell, useDocumentStatus } from "../../core/index";
import type {
  AnnotatorHandle,
  DocumentStatus,
  DocxAnnotatorProps,
} from "../../core/index";
import type { DocxScope } from "../isolation";
import { useDocxDocument } from "../loader";
import type { DocxDocument } from "../loader";
import { deferred, fakeDocxodus, flushPromises } from "./docxodusFake";
import type { Deferred } from "./docxodusFake";

// jsdom parses style sheets only in its main document (see `jsdomCss.ts`).
vi.mock("../isolation", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../isolation")>();
  const { parseInJsdom } = await import("./jsdomCss");
  return {
    ...actual,
    isolateDocument: (html: string, scope: DocxScope) =>
      actual.isolateDocument(html, scope, parseInJsdom),
  };
});

vi.mock("docxodus", async () =>
  (await import("./docxodusFake")).docxodusModule()
);

type Source = DocxAnnotatorProps["source"];

const WASM = "/wasm/";

/** One `fetch` call the test answers. */
type FetchCall = { url: string; signal: AbortSignal } & Deferred<Response>;

let fetches: FetchCall[];

beforeEach(() => {
  fakeDocxodus.reset();
  fetches = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init: { signal: AbortSignal }) => {
      const call = { url, signal: init.signal, ...deferred<Response>() };
      fetches.push(call);
      return call.promise;
    })
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

type Log = { statuses: DocumentStatus[]; documents: (DocxDocument | null)[] };

const SCOPE: DocxScope = {
  id: "s1",
  selector: '[data-rca-docx="s1"]',
  idPrefix: "rca-s1-",
  documentPrefix: "rca-s1-docx-",
  pagePrefix: "rca-s1-page-",
};

function Probe({
  source,
  wasmBaseUrl,
  log,
}: {
  source: Source;
  wasmBaseUrl: string;
  log: Log;
}) {
  const document = useDocxDocument(source, wasmBaseUrl, SCOPE);
  const status = useDocumentStatus();
  // Every committed document, so a stale one shown for a single commit is
  // seen too.
  log.documents.push(document);
  useEffect(() => {
    log.statuses.push(status);
  }, [log, status]);
  return null;
}

function setup(
  source: Source,
  {
    strict = false,
    wasmBaseUrl = WASM,
  }: { strict?: boolean; wasmBaseUrl?: string } = {}
) {
  const log: Log = { statuses: [], documents: [] };
  const handleRef = createRef<AnnotatorHandle>();
  const element = (next: Source, wasm: string) => {
    const tree: ReactElement = (
      <AnnotatorShell common={{ annotations: [] }} handleRef={handleRef}>
        <Probe source={next} wasmBaseUrl={wasm} log={log} />
      </AnnotatorShell>
    );
    return strict ? <StrictMode>{tree}</StrictMode> : tree;
  };
  const view = render(element(source, wasmBaseUrl));
  return {
    log,
    rerender: (next: Source, wasm = wasmBaseUrl) =>
      view.rerender(element(next, wasm)),
    unmount: () => view.unmount(),
  };
}

const BYTES = new Uint8Array([80, 75, 3, 4]);

function docxResponse(bytes = BYTES, headers: Record<string, string> = {}) {
  return new Response(bytes, { status: 200, headers });
}

async function settle() {
  await act(async () => {
    await flushPromises();
  });
}

/** Answers fetch `index` with the DOCX bytes and lets its conversion start. */
async function answerFetch(index: number, response = docxResponse()) {
  await act(async () => {
    fetches[index].resolve(response);
    await flushPromises();
  });
}

async function finishConversion(index: number, html: string) {
  await act(async () => {
    fakeDocxodus.conversions[index].resolve(html);
    await flushPromises();
  });
}

const states = (log: Log) => log.statuses.map((s) => s.state);
const lastHtml = (log: Log) => log.documents.at(-1)?.html ?? null;
const shownHtml = (log: Log) =>
  log.documents.flatMap((d) => (d === null ? [] : [d.html]));

test("a url source is fetched, the runtime initialised from wasmBaseUrl, and the html sanitised and made the annotator's own", async () => {
  const { log } = setup({ url: "/a.docx" });
  expect(fetches.map((f) => f.url)).toEqual(["/a.docx"]);
  expect(fakeDocxodus.initialize).toHaveBeenCalledWith(WASM);
  expect(states(log)).toEqual(["loading"]);

  await answerFetch(0);
  expect(fakeDocxodus.conversions).toHaveLength(1);
  expect(Array.from(fakeDocxodus.conversions[0].bytes)).toEqual(
    Array.from(BYTES)
  );
  // The document's and the pagination's classes are the annotator's own.
  expect(fakeDocxodus.convertDocxToHtml.mock.calls[0][1]).toEqual({
    paginationMode: 1,
    cssPrefix: "rca-s1-docx-",
    paginationCssClassPrefix: "rca-s1-page-",
  });

  await finishConversion(
    0,
    "<style>body { margin: 0 } .rca-s1-page-box { color: red }</style>" +
      '<div id="pagination-staging" class="rca-s1-page-staging"><p id="b1" onclick="x()">Hi</p><script>bad()</script></div>' +
      '<div id="pagination-container" class="rca-s1-page-container"></div>'
  );
  expect(lastHtml(log)).toBe(
    '<div class="rca-s1-page-staging"><p id="rca-s1-b1">Hi</p></div>' +
      '<div class="rca-s1-page-container"></div>'
  );
  expect(log.documents.at(-1)?.css).toBe(
    '[data-rca-docx="s1"] { margin: 0; }\n' +
      '[data-rca-docx="s1"] .rca-s1-page-box { color: red; }'
  );
  // `ready` is the view's to report, once the document is laid out.
  expect(states(log)).toEqual(["loading"]);
});

test("a data source is converted without fetching", async () => {
  const data = new Uint8Array([1, 2, 3]);
  const { log } = setup({ data });
  await settle();
  expect(fetch).not.toHaveBeenCalled();
  expect(fakeDocxodus.conversions[0].bytes).toBe(data);
  await finishConversion(0, "<p>data</p>");
  expect(lastHtml(log)).toBe("<p>data</p>");
});

test("download progress is reported while the length is known", async () => {
  const { log } = setup({ url: "/a.docx" });
  await answerFetch(
    0,
    docxResponse(new Uint8Array(8), { "content-length": "16" })
  );
  expect(log.statuses.map((s) => s.progress)).toEqual([null, 50]);
  expect(Array.from(fakeDocxodus.conversions[0].bytes)).toEqual(
    Array(8).fill(0)
  );
});

test("an HTTP failure, an init failure and a conversion failure each report error", async () => {
  const http = setup({ url: "/missing.docx" });
  await answerFetch(0, new Response("", { status: 404 }));
  expect(states(http.log)).toEqual(["loading", "error"]);
  expect(http.log.statuses[1].error?.message).toBe(
    "Failed to fetch /missing.docx: HTTP 404"
  );
  http.unmount();

  const initFailure = new Error("no wasm here");
  fakeDocxodus.initialize.mockImplementation(() => Promise.reject(initFailure));
  const init = setup({ data: BYTES });
  await settle();
  expect(init.log.statuses.at(-1)?.error).toBe(initFailure);
  expect(fakeDocxodus.conversions).toHaveLength(0);
  init.unmount();

  fakeDocxodus.initialize.mockImplementation(() => Promise.resolve());
  const convert = setup({ data: new Uint8Array([9]) });
  await settle();
  const failure = new Error("not a docx");
  await act(async () => {
    fakeDocxodus.conversions[0].reject(failure);
    await flushPromises();
  });
  expect(states(convert.log)).toEqual(["loading", "error"]);
  expect(convert.log.statuses[1].error).toBe(failure);
});

test("changing source mid-fetch aborts the first fetch and ignores its response", async () => {
  const { log, rerender } = setup({ url: "/a.docx" });
  rerender({ url: "/b.docx" });
  expect(fetches[0].signal.aborted).toBe(true);
  expect(fetches[1].signal.aborted).toBe(false);

  await answerFetch(0);
  expect(fakeDocxodus.conversions).toHaveLength(0);

  await answerFetch(1);
  await finishConversion(0, "<p>B</p>");
  expect(shownHtml(log)).toEqual(["<p>B</p>"]);
  expect(states(log)).toEqual(["loading"]);
});

test("changing source mid-conversion ignores the late conversion", async () => {
  const { log, rerender } = setup({ url: "/a.docx" });
  await answerFetch(0);
  rerender({ url: "/b.docx" });
  await answerFetch(1);

  await finishConversion(0, "<p>A</p>");
  expect(shownHtml(log)).toEqual([]);

  await finishConversion(1, "<p>B</p>");
  expect(shownHtml(log)).toEqual(["<p>B</p>"]);
});

test("A -> B -> A never shows A's earlier html while the new load is pending", async () => {
  const { log, rerender } = setup({ url: "/a.docx" });
  await answerFetch(0);
  await finishConversion(0, "<p>A</p>");
  expect(lastHtml(log)).toBe("<p>A</p>");
  const shownBefore = log.documents.length;

  rerender({ url: "/b.docx" }); // never answered
  await settle();
  rerender({ url: "/a.docx" });
  await settle();

  // Not for a single commit: every document committed since is null.
  expect(log.documents.slice(shownBefore).every((d) => d === null)).toBe(true);
  expect(states(log).at(-1)).toBe("loading");
  expect(fetches.map((f) => f.url)).toEqual(["/a.docx", "/b.docx", "/a.docx"]);

  await answerFetch(2);
  await finishConversion(1, "<p>A again</p>");
  expect(lastHtml(log)).toBe("<p>A again</p>");
});

test("a new source object with the same url, or the same data, does not reload", async () => {
  const { log, rerender } = setup({ url: "/a.docx" });
  await answerFetch(0);
  await finishConversion(0, "<p>A</p>");
  rerender({ url: "/a.docx" });
  await settle();
  expect(fetches).toHaveLength(1);
  expect(states(log)).toEqual(["loading"]);

  const data = new Uint8Array([7]);
  rerender({ data });
  await settle();
  rerender({ data });
  await settle();
  expect(fakeDocxodus.conversions).toHaveLength(2);
});

test("a new wasmBaseUrl loads again from it", async () => {
  const data = new Uint8Array([7]);
  const { rerender } = setup({ data });
  await settle();
  rerender({ data }, "/other-wasm/");
  await settle();
  expect(fakeDocxodus.initialize.mock.calls.map(([base]) => base)).toEqual([
    WASM,
    "/other-wasm/",
  ]);
});

test("unmount mid-fetch aborts it; unmount mid-conversion sets no state", async () => {
  const error = vi.spyOn(console, "error");
  const fetching = setup({ url: "/a.docx" });
  fetching.unmount();
  expect(fetches[0].signal.aborted).toBe(true);
  await answerFetch(0);
  expect(fakeDocxodus.conversions).toHaveLength(0);

  const converting = setup({ url: "/b.docx" });
  await answerFetch(1);
  converting.unmount();
  await act(async () => {
    fakeDocxodus.conversions[0].resolve("<p>late</p>");
    await flushPromises();
  });
  expect(shownHtml(converting.log)).toEqual([]);
  expect(error).not.toHaveBeenCalled();
  error.mockRestore();
});

test("StrictMode double mount ends with one live conversion", async () => {
  const { log } = setup({ url: "/a.docx" }, { strict: true });
  expect(fetches).toHaveLength(2);
  expect(fetches.filter((f) => !f.signal.aborted)).toHaveLength(1);

  await answerFetch(0);
  await answerFetch(1);
  expect(fakeDocxodus.conversions).toHaveLength(1);

  await finishConversion(0, "<p>A</p>");
  expect(lastHtml(log)).toBe("<p>A</p>");
  expect(states(log).at(-1)).toBe("loading");
});
