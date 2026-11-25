/**
 * Loads the DOCX named by the `source` prop and converts it to sanitised
 * HTML: the first two stages of OpenContracts' `DocxAnnotator` pipeline
 * (`renderers/docx/DocxAnnotator.tsx`, 98286cabf), initialising the
 * docxodus WASM runtime and converting once with DOMPurify. The view
 * (`DocxView`) projects annotations onto the result.
 *
 * A load is keyed on what identifies the document — the `url`, or the
 * `data` object — and on `wasmBaseUrl`, not on the `source` object, so a
 * host that passes a fresh `source` literal on every render loads once.
 * Reporting `loading` re-arms the shell's `onDocumentLoad` and deep-link
 * scroll, so it is reported only when that key changes; the view reports
 * `ready` once the document is laid out.
 *
 * Each run of the load effect is a load of its own: its fetch is aborted and
 * any later result ignored once the key changes or the component unmounts
 * (so StrictMode's replayed mount leaves one live conversion). The document
 * returned is the current key's: in the render where the key changes it is
 * already null, and each load starts by letting go of the previous one, so
 * a document is never shown under another key, nor a finished earlier load
 * of the same key (A → B → A) while its new load is pending.
 *
 * Changed from OpenContracts: the runtime is initialised from the host's
 * `wasmBaseUrl` (no `import.meta.env`), in parallel with fetching the bytes;
 * failures are reported through the document status instead of a message in
 * the view; and the ids the paginated HTML gives its staging and page
 * containers (which would collide between two annotators) are removed.
 */
import DOMPurify from "dompurify";
import type { Config } from "dompurify";
import { convertDocxToHtml, initialize, PaginationMode } from "docxodus";
import { useEffect, useState } from "react";

import { useSetDocumentStatus } from "../core/index";
import type { DocxAnnotatorProps } from "../core/index";

export type DocxSource = DocxAnnotatorProps["source"];

/** The converted HTML of one load; a new object for every load. */
export interface DocxDocument {
  readonly html: string;
}

/**
 * DOMPurify config that preserves docxodus formatting (styles, classes)
 * while blocking scripts, event handlers, and dangerous elements.
 */
const SANITIZE_CONFIG: Config = {
  FORCE_BODY: true,
  ADD_ATTR: [
    "data-annotation-id",
    "data-label-id",
    "data-label",
    "class",
    "style",
  ],
  ADD_TAGS: ["style"],
};

/**
 * The ids of `PaginatedDocument`'s staging and page containers. It finds
 * them by their classes too, and two annotators on a page would repeat them.
 */
const PAGINATION_IDS = /\sid="pagination-(?:staging|container)"/g;

/** docxodus HTML, sanitised (see `SANITIZE_CONFIG`) and without fixed ids. */
export function sanitizeDocxHtml(html: string): string {
  return DOMPurify.sanitize(html, SANITIZE_CONFIG).replace(PAGINATION_IDS, "");
}

function toError(reason: unknown): Error {
  return reason instanceof Error ? reason : new Error(String(reason));
}

/** Download progress, 0..100. */
function progressPercent(loaded: number, total: number): number {
  return Math.min(100, Math.max(0, Math.round((loaded / total) * 100)));
}

/**
 * The bytes at `url`. While the length is announced, `onProgress` hears the
 * share downloaded so far.
 */
async function fetchBytes(
  url: string,
  signal: AbortSignal,
  onProgress: (percent: number) => void
): Promise<Uint8Array> {
  const response = await fetch(url, { signal });
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: HTTP ${response.status}`);
  }
  const total = Number(response.headers.get("content-length"));
  if (!response.body || !(total > 0)) {
    return new Uint8Array(await response.arrayBuffer());
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    onProgress(progressPercent(loaded, total));
  }
  const bytes = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}

/** The document of one finished load, with the key it was loaded for. */
type Loaded = DocxDocument & {
  url: string | undefined;
  data: Uint8Array | undefined;
  wasmBaseUrl: string;
};

/**
 * Loads `source`, reports `loading` and failures through the shell's
 * document status, and returns the current document; null until it has
 * loaded.
 */
export function useDocxDocument(
  source: DocxSource,
  wasmBaseUrl: string
): DocxDocument | null {
  const setStatus = useSetDocumentStatus();
  const [loaded, setLoaded] = useState<Loaded | null>(null);

  const url = "url" in source ? source.url : undefined;
  const data = "data" in source ? source.data : undefined;

  useEffect(() => {
    let cancelled = false;
    const abort = new AbortController();
    // The previous document is gone with its key.
    setLoaded(null);
    setStatus({ state: "loading" });

    const bytes =
      data !== undefined
        ? Promise.resolve(data)
        : fetchBytes(url ?? "", abort.signal, (progress) => {
            if (!cancelled) setStatus({ state: "loading", progress });
          });

    Promise.all([initialize(wasmBaseUrl), bytes])
      .then(([, docx]) =>
        cancelled
          ? null
          : convertDocxToHtml(docx, {
              paginationMode: PaginationMode.Paginated,
            })
      )
      .then((html) => {
        if (cancelled || html === null) return;
        setLoaded({ html: sanitizeDocxHtml(html), url, data, wasmBaseUrl });
      })
      .catch((reason: unknown) => {
        if (cancelled) return;
        setStatus({ state: "error", error: toError(reason) });
      });

    return () => {
      cancelled = true;
      abort.abort();
    };
  }, [setStatus, url, data, wasmBaseUrl]);

  return loaded !== null &&
    loaded.url === url &&
    loaded.data === data &&
    loaded.wasmBaseUrl === wasmBaseUrl
    ? loaded
    : null;
}
