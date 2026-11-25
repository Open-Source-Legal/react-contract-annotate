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
 * projected can be read back from the DOM. `PaginatedDocument` renders the
 * HTML inside a `.page-container` and reports pagination on mount and on
 * every new `html`.
 */
import { useEffect } from "react";
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
        html +
          set.labelledText
            .map(
              (entry) =>
                `<span data-annotation-id="${entry.id}" data-label-id="${entry.annotationLabel}">${entry.rawText}</span>`
            )
            .join("")
      )
  ),
  generateAnnotationCss: vi.fn(() => Promise.resolve("")),
  reset() {
    fakeDocxodus.conversions = [];
    fakeDocxodus.initialize.mockReset();
    fakeDocxodus.initialize.mockImplementation(() => Promise.resolve());
    fakeDocxodus.convertDocxToHtml.mockClear();
    fakeDocxodus.projectAnnotationsOntoHtml.mockClear();
    fakeDocxodus.generateAnnotationCss.mockClear();
  },
};

export function docxodusModule() {
  return {
    initialize: fakeDocxodus.initialize,
    convertDocxToHtml: fakeDocxodus.convertDocxToHtml,
    projectAnnotationsOntoHtml: fakeDocxodus.projectAnnotationsOntoHtml,
    generateAnnotationCss: fakeDocxodus.generateAnnotationCss,
    findTextOccurrences: (text: string, query: string) => {
      const found: { start: number; end: number }[] = [];
      for (
        let at = text.indexOf(query);
        at >= 0;
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

function FakePaginatedDocument({
  html,
  onPaginationComplete,
}: {
  html: string;
  onPaginationComplete?: () => void;
}) {
  useEffect(() => {
    onPaginationComplete?.();
  }, [html, onPaginationComplete]);
  return (
    <div
      className="page-container"
      data-fake-paginated=""
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

export function docxodusReactModule() {
  return { PaginatedDocument: FakePaginatedDocument };
}

/** Lets every pending promise callback run. */
export function flushPromises(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
