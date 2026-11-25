/**
 * A stand-in for docxodus (and `docxodus/react`) in unit tests, which run
 * without its WebAssembly runtime. Tests mock the modules with it:
 *
 *   vi.mock("docxodus", async () => (await import("./docxodusFake")).docxodusModule());
 *   vi.mock("docxodus/react", async () => (await import("./docxodusFake")).docxodusReactModule());
 *
 * `initialize` resolves at once; each `convertDocxToHtml` call is recorded
 * with a promise the test settles; projection appends a marker per entry to
 * the HTML (`<span data-annotation-id=… data-label-id=…>`), so what was
 * projected can be read back from the DOM; like docxodus 12.4.1 it adds a
 * stylesheet of the label records (ids unescaped) and it draws
 * only one of two overlapping spans (the one starting first; the earlier
 * entry on a tie). `findTextOccurrences` stops at `maxResults` (default 100),
 * as docxodus' does. `usePagination` writes the HTML into the container it
 * is given, inside a page container (`<cssPrefix>container`), and reports a
 * new result for every new `html`, or fails when `paginationError` is set.
 */
import { useEffect, useState } from "react";
import type { RefObject } from "react";
import type { ExternalAnnotationSet } from "docxodus";

export type Deferred<T> = {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(reason: unknown): void;
};

export function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

export type Conversion = { bytes: Uint8Array } & Deferred<string>;

export const fakeDocxodus = {
  initialize: vi.fn((_basePath?: string) => Promise.resolve()),
  conversions: [] as Conversion[],
  convertDocxToHtml: vi.fn((bytes: Uint8Array, _options?: unknown) => {
    const conversion = { bytes, ...deferred<string>() };
    fakeDocxodus.conversions.push(conversion);
    return conversion.promise;
  }),
  projectAnnotationsOntoHtml: vi.fn(
    (html: string, set: ExternalAnnotationSet) =>
      Promise.resolve(
        labelStylesheet(set) + html + drawnEntries(set).map(marker).join("")
      )
  ),
  /** When set, every pagination fails with it. */
  paginationError: null as Error | null,
  reset() {
    fakeDocxodus.paginationError = null;
    fakeDocxodus.conversions = [];
    fakeDocxodus.initialize.mockReset();
    fakeDocxodus.initialize.mockImplementation(() => Promise.resolve());
    fakeDocxodus.convertDocxToHtml.mockClear();
    fakeDocxodus.projectAnnotationsOntoHtml.mockClear();
  },
};

type Entry = ExternalAnnotationSet["labelledText"][number];
type Span = { start: number; end: number };

function spanOf(entry: Entry): Span {
  return entry.annotationJson as Span;
}

/** The entries docxodus would draw: none overlapping one drawn before. */
function drawnEntries(set: ExternalAnnotationSet): Entry[] {
  const byStart = set.labelledText
    .map((entry, index) => ({ entry, index }))
    .sort(
      (a, b) =>
        spanOf(a.entry).start - spanOf(b.entry).start || a.index - b.index
    );
  const drawn: Entry[] = [];
  for (const { entry } of byStart) {
    const span = spanOf(entry);
    const free = drawn.every((other) => {
      const taken = spanOf(other);
      return span.end <= taken.start || taken.end <= span.start;
    });
    if (free) drawn.push(entry);
  }
  return drawn;
}

/** The stylesheet docxodus adds to projected HTML: label ids unescaped. */
function labelStylesheet(set: ExternalAnnotationSet): string {
  const rules = Object.values(set.textLabels).map(
    (label) => `.oc-annot-label-${label.id} { --annot-color: ${label.color}; }`
  );
  return `<style>${rules.join("\n")}</style>`;
}

function marker(entry: Entry): string {
  return `<span data-annotation-id="${entry.id}" data-label-id="${entry.annotationLabel}">${entry.rawText}</span>`;
}

export function docxodusModule() {
  return {
    initialize: fakeDocxodus.initialize,
    convertDocxToHtml: fakeDocxodus.convertDocxToHtml,
    projectAnnotationsOntoHtml: fakeDocxodus.projectAnnotationsOntoHtml,
    findTextOccurrences: (text: string, query: string, maxResults = 100) => {
      const found: { start: number; end: number }[] = [];
      for (
        let at = text.indexOf(query);
        at >= 0 && found.length < maxResults;
        at = text.indexOf(query, at + 1)
      ) {
        found.push({ start: at, end: at + query.length });
      }
      return query ? found : [];
    },
    AnnotationLabelMode: { Above: 0, Inline: 1, Tooltip: 2, None: 3 },
    PaginationMode: { None: 0, Paginated: 1 },
  };
}

/**
 * `usePagination`: like docxodus', it writes into the container itself and
 * reports a new result for every new `html` (and options), or the error of a
 * failed pagination (`fakeDocxodus.paginationError`), after putting the HTML
 * in the container as the real one does before it fails.
 */
function fakeUsePagination(
  html: string,
  containerRef: RefObject<HTMLElement | null>,
  { cssPrefix = "page-", scale = 1 }: { cssPrefix?: string; scale?: number } = {}
) {
  const [result, setResult] = useState<{ totalPages: number } | null>(null);
  const [error, setError] = useState<Error | null>(null);
  useEffect(() => {
    const container = containerRef.current;
    if (!html || !container) return;
    const failure = fakeDocxodus.paginationError;
    if (failure) {
      container.innerHTML = html;
      setError(failure);
      return;
    }
    container.innerHTML = `<div class="${cssPrefix}container" data-fake-paginated="">${html}</div>`;
    setError(null);
    setResult({ totalPages: 1 });
  }, [html, containerRef, cssPrefix, scale]);
  return { result, isPaginating: false, error, paginate: () => {} };
}

export function docxodusReactModule() {
  return { usePagination: fakeUsePagination };
}

/** Lets every pending promise callback run. */
export function flushPromises(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
