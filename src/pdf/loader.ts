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
 */
import { atom, useAtomValue } from "jotai";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import type {
  DocumentInitParameters,
  OnProgressParameters,
  PDFDocumentLoadingTask,
  PDFDocumentProxy,
  PDFPageProxy,
} from "pdfjs-dist/types/src/display/api";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import {
  expandPawlsPages,
  resolvePageTokens,
  useAnnotatorStore,
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
 * until the document has loaded. Read and written through the instance
 * store only.
 */
export const pdfPagesAtom = atom<PDFPageInfo[]>(NO_PAGES);

/** The pages of the annotator's document; empty until it has loaded. */
export function usePdfPages(): PDFPageInfo[] {
  const store = useAnnotatorStore("usePdfPages");
  return useAtomValue(pdfPagesAtom, { store });
}

/** What identifies one document load. */
type LoadKey = {
  url: string | undefined;
  withCredentials: boolean | undefined;
  data: Uint8Array | ArrayBuffer | undefined;
  document: PdfDocumentProxyLike | undefined;
};

function loadKeyOf(source: PdfSource): LoadKey {
  return {
    url: "url" in source ? source.url : undefined,
    withCredentials: "url" in source ? source.withCredentials : undefined,
    data: "data" in source ? source.data : undefined,
    document: "document" in source ? source.document : undefined,
  };
}

function sameLoadKey(a: LoadKey, b: LoadKey): boolean {
  return (
    a.url === b.url &&
    a.withCredentials === b.withCredentials &&
    a.data === b.data &&
    a.document === b.document
  );
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

/**
 * Loads `source`, reports the loading state through the shell's document
 * status, and fills `pdfPagesAtom`. Cancels (and destroys the loading task
 * of) a load whose key changed or whose component unmounted; never destroys
 * a `PDFDocumentProxy` the host passed in as `{ document }`.
 */
export function usePdfDocument(
  source: PdfSource,
  pawls: PawlsInput | null | undefined
): void {
  const store = useAnnotatorStore("usePdfDocument");
  const setStatus = useSetDocumentStatus();
  const key = loadKeyOf(source);

  // Read at load time, so new header objects alone never reload.
  const httpHeaders = "url" in source ? source.httpHeaders : undefined;
  const headersRef = useRef(httpHeaders);
  useLayoutEffect(() => {
    headersRef.current = httpHeaders;
  });

  const [loaded, setLoaded] = useState<{
    key: LoadKey;
    pages: PDFPageProxy[];
  } | null>(null);

  const { url, withCredentials, data, document } = key;
  useEffect(() => {
    const thisLoad: LoadKey = { url, withCredentials, data, document };
    let cancelled = false;
    // The previous document's pages are gone with its loading task.
    store.set(pdfPagesAtom, NO_PAGES);
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
      .then((pages) => {
        if (cancelled || !pages) return;
        setLoaded({ key: thisLoad, pages });
      })
      .catch((reason: unknown) => {
        if (cancelled) return;
        setStatus({ state: "error", error: toError(reason) });
      });

    return () => {
      cancelled = true;
      // Settles the document promise (rejecting it), which the chain above
      // ignores now that the load is cancelled.
      task?.destroy().catch(() => {});
    };
  }, [store, setStatus, url, withCredentials, data, document]);

  // The pages of the current key only: right after the key changes, `loaded`
  // still holds the previous document until the new one arrives.
  const pages = loaded && sameLoadKey(loaded.key, key) ? loaded.pages : null;
  useEffect(() => {
    if (!pages) return;
    // Pages first, so the status change finds them (`onDocumentLoad` reads
    // the page count and text).
    store.set(pdfPagesAtom, buildPages(pages, pawls));
    setStatus({ state: "ready" });
  }, [store, setStatus, pages, pawls]);
}
