/**
 * Loads the PDF named by the `source` prop and builds its pages with their
 * PAWLs tokens. Ported from the PDF branch of OpenContracts' document loader
 * (`knowledge_base/document/document_kb/useDocumentLoader.ts`, 98286cabf):
 * `getDocument`, progress, then one `PDFPageInfo` per page with
 * `resolvePageTokens`.
 *
 * A load is keyed on what identifies the document — the `url` (with
 * `withCredentials`), the `data` object or the `document` object — not on the
 * `source` object, so a host that passes a fresh `source` literal on every
 * render loads once. Reporting `loading` re-arms the shell's `onDocumentLoad`
 * and deep-link scroll, so it is reported only when such a key changes. New
 * `pawls` rebuild the pages' tokens without a reload and without reporting
 * `loading`.
 *
 * The pages are React state of the component that calls `usePdfDocument`
 * (the PDF format), which hands them down through `PdfPagesContext`.
 */
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import type {
  DocumentInitParameters,
  OnProgressParameters,
  PDFDocumentLoadingTask,
  PDFDocumentProxy,
  PDFPageProxy,
} from "pdfjs-dist/types/src/display/api";
import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import {
  expandPawlsPages,
  resolvePageTokens,
  useSetDocumentStatus,
} from "../core/index";
import type {
  PawlsInput,
  PdfAnnotatorProps,
  PdfDocumentProxyLike,
} from "../core/index";
import { PDFPageInfo } from "./PDFPageInfo";

export type PdfSource = PdfAnnotatorProps["source"];

const NO_PAGES: PDFPageInfo[] = Object.freeze([]) as unknown as PDFPageInfo[];

/**
 * The document's pages in page order, each with its tokens at scale 1; empty
 * until the document has loaded. Provided by the PDF format.
 */
export const PdfPagesContext = createContext<PDFPageInfo[]>(NO_PAGES);

/** The pages of the annotator's document; empty until it has loaded. */
export function usePdfPages(): PDFPageInfo[] {
  return useContext(PdfPagesContext);
}

/**
 * The `document` prop is typed structurally in core (which may not import
 * pdf.js); it is pdf.js' own `PDFDocumentProxy`.
 */
function asPdfDocument(document: PdfDocumentProxyLike): PDFDocumentProxy {
  return document as PDFDocumentProxy;
}

/**
 * pdf.js transfers the bytes it is given to its worker, which detaches the
 * caller's buffer. It gets a copy, so the host's bytes stay usable and a
 * second load (a remount, StrictMode's replayed effect) can read them again.
 */
function copyBytes(data: Uint8Array | ArrayBuffer): Uint8Array {
  return data instanceof ArrayBuffer
    ? new Uint8Array(data.slice(0))
    : new Uint8Array(data);
}

/** Loading progress, 0..100, or null while the length is unknown. */
function progressPercent({
  loaded,
  total,
}: OnProgressParameters): number | null {
  if (!(total > 0)) return null;
  return Math.min(100, Math.max(0, Math.round((loaded / total) * 100)));
}

function toError(reason: unknown): Error {
  return reason instanceof Error ? reason : new Error(String(reason));
}

function fetchPages(document: PDFDocumentProxy): Promise<PDFPageProxy[]> {
  return Promise.all(
    Array.from({ length: document.numPages }, (_, i) => document.getPage(i + 1))
  );
}

/**
 * One `PDFPageInfo` per page. Tokens are normalised to pdf.js' page size;
 * without PAWLs every page has none (and nothing is warned: the pages and
 * bounds-only annotations still render).
 */
function buildPages(
  pages: PDFPageProxy[],
  pawls: PawlsInput | null | undefined
): PDFPageInfo[] {
  const pawlsPages = pawls == null ? null : expandPawlsPages(pawls);
  return pages.map((page) => {
    const viewport = page.getViewport({ scale: 1 });
    const tokens = pawlsPages
      ? resolvePageTokens(
          pawlsPages,
          page.pageNumber - 1,
          viewport.width,
          viewport.height,
          page.pageNumber
        )
      : [];
    return new PDFPageInfo(page, tokens, 1);
  });
}

/** The page proxies of one finished load; `load` identifies that load. */
type Loaded = { load: object; pages: PDFPageProxy[] };

/**
 * Loads `source`, reports the loading state through the shell's document
 * status, and returns the document's pages (empty until loaded). Cancels
 * (and destroys the loading task of) a load whose key changed or whose
 * component unmounted; never destroys a `PDFDocumentProxy` the host passed
 * in as `{ document }`.
 */
export function usePdfDocument(
  source: PdfSource,
  pawls: PawlsInput | null | undefined
): PDFPageInfo[] {
  const setStatus = useSetDocumentStatus();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [pages, setPages] = useState<PDFPageInfo[]>(NO_PAGES);
  /** The load in progress or finished for the current key; null after unmount. */
  const currentLoad = useRef<object | null>(null);

  // Read at load time, so new header objects alone never reload.
  const httpHeaders = "url" in source ? source.httpHeaders : undefined;
  const headersRef = useRef(httpHeaders);
  useLayoutEffect(() => {
    headersRef.current = httpHeaders;
  });

  const url = "url" in source ? source.url : undefined;
  const withCredentials = "url" in source ? source.withCredentials : undefined;
  const data = "data" in source ? source.data : undefined;
  const document = "document" in source ? source.document : undefined;

  useEffect(() => {
    // Each run is a load of its own. A load finished under an earlier key is
    // never published, even when the key comes back to the same value: its
    // loading task has been destroyed.
    const load = {};
    currentLoad.current = load;
    let cancelled = false;
    // The previous document's pages are gone with its loading task; let go
    // of them and of its page proxies.
    setLoaded(null);
    setPages(NO_PAGES);
    setStatus({ state: "loading" });

    let task: PDFDocumentLoadingTask | null = null;
    let documentPromise: Promise<PDFDocumentProxy>;
    if (document !== undefined) {
      documentPromise = Promise.resolve(asPdfDocument(document));
    } else {
      const params: DocumentInitParameters =
        data !== undefined
          ? { data: copyBytes(data) }
          : { url, httpHeaders: headersRef.current, withCredentials };
      task = getDocument(params);
      task.onProgress = (progress: OnProgressParameters) => {
        if (cancelled) return;
        setStatus({ state: "loading", progress: progressPercent(progress) });
      };
      documentPromise = task.promise;
    }

    documentPromise
      .then((pdf) => (cancelled ? null : fetchPages(pdf)))
      .then((pdfPages) => {
        if (cancelled || !pdfPages) return;
        setLoaded({ load, pages: pdfPages });
      })
      .catch((reason: unknown) => {
        if (cancelled) return;
        setStatus({ state: "error", error: toError(reason) });
      });

    return () => {
      cancelled = true;
      if (currentLoad.current === load) currentLoad.current = null;
      // Settles the document promise (rejecting it), which the chain above
      // ignores now that the load is cancelled.
      task?.destroy().catch(() => {});
    };
  }, [setStatus, url, withCredentials, data, document]);

  useEffect(() => {
    // In the commit where the key changes, `loaded` still holds the previous
    // load; the effect above has already made the new one current.
    if (!loaded || loaded.load !== currentLoad.current) return;
    // Pages first, so the status change finds them (`onDocumentLoad` reads
    // the page count and text); both land in the same render.
    setPages(buildPages(loaded.pages, pawls));
    setStatus({ state: "ready" });
  }, [setStatus, loaded, pawls]);

  return pages;
}
