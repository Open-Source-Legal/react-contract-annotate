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
 * the view; the sanitiser keeps only the elements and attributes docxodus
 * writes (`htmlAllowList.ts`) instead of DOMPurify's defaults; and the
 * document is made the annotator's own (`isolation.ts`): converted with the
 * scope's class prefixes, its stylesheet taken out, scoped and reduced to
 * allow-listed declarations (and dropped, with a development warning, when
 * the result fails its validation), its inline styles reduced the same way,
 * its ids prefixed, its links opened in a new tab and its images' sources
 * kept only when they are `data:` URLs.
 */
import DOMPurify from "dompurify";
import type { Config } from "dompurify";
import { convertDocxToHtml, initialize, PaginationMode } from "docxodus";
import { useEffect, useState } from "react";

import { useDevWarnOnce, useSetDocumentStatus } from "../core/index";
import type { DocxAnnotatorProps } from "../core/index";
import { ALLOWED_ATTRIBUTES, ALLOWED_TAGS } from "./htmlAllowList";
import { isolateDocument } from "./isolation";
import type { DocxScope } from "./isolation";

export type DocxSource = DocxAnnotatorProps["source"];

/** The converted document of one load; a new object for every load. */
export interface DocxDocument {
  /** Its HTML, without its stylesheet. */
  readonly html: string;
  /** Its stylesheet, scoped to the annotator (see `isolation.ts`). */
  readonly css: string;
}

/**
 * DOMPurify config: only the elements and attributes docxodus writes
 * (`htmlAllowList.ts`), its `data-*` attributes, and its `<style>` blocks
 * (taken out by `isolateDocument`).
 */
const SANITIZE_CONFIG: Config = {
  FORCE_BODY: true,
  ALLOWED_TAGS: [...ALLOWED_TAGS],
  ALLOWED_ATTR: [...ALLOWED_ATTRIBUTES],
  ADD_TAGS: ["style"],
};

const REJECTED_STYLESHEET_WARNING =
  "The DOCX annotator dropped the document's own stylesheet: once scoped to " +
  "the annotator and reduced to the declarations it allows, it did not " +
  "parse back to exactly those rules (a crafted or malformed document). " +
  "The document is shown without it.";

/** Converted docxodus HTML, sanitised (see `SANITIZE_CONFIG`). */
export function sanitizeDocxHtml(html: string): string {
  return DOMPurify.sanitize(html, SANITIZE_CONFIG);
}

/**
 * For projected HTML: `SANITIZE_CONFIG` without `<style>`. Projection adds a
 * stylesheet of its own, built from the label records with the label ids
 * unescaped (`.oc-annot-label-<id> { … }`), which would apply to the whole
 * page; nothing needs it (the document's stylesheet was taken out and scoped
 * before projection, and `styles.ts` writes the annotation rules).
 */
const SANITIZE_PROJECTED_CONFIG: Config = {
  ...SANITIZE_CONFIG,
  ADD_TAGS: [],
  FORBID_TAGS: ["style"],
};

/** Projected docxodus HTML, sanitised, without any stylesheet. */
export function sanitizeProjectedHtml(html: string): string {
  return DOMPurify.sanitize(html, SANITIZE_PROJECTED_CONFIG);
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
 * Loads `source` as the document of the annotator `scope` belongs to (one
 * scope for the life of the component), reports `loading` and failures
 * through the shell's document status, and returns the current document;
 * null until it has loaded.
 */
export function useDocxDocument(
  source: DocxSource,
  wasmBaseUrl: string,
  scope: DocxScope
): DocxDocument | null {
  const setStatus = useSetDocumentStatus();
  const warnOnce = useDevWarnOnce();
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
              cssPrefix: scope.documentPrefix,
              paginationCssClassPrefix: scope.pagePrefix,
            })
      )
      .then((html) => {
        if (cancelled || html === null) return;
        const isolated = isolateDocument(sanitizeDocxHtml(html), scope);
        if (isolated.cssRejected) {
          warnOnce("docx-stylesheet-rejected", REJECTED_STYLESHEET_WARNING);
        }
        setLoaded({
          html: isolated.html,
          css: isolated.css,
          url,
          data,
          wasmBaseUrl,
        });
      })
      .catch((reason: unknown) => {
        if (cancelled) return;
        setStatus({ state: "error", error: toError(reason) });
      });

    return () => {
      cancelled = true;
      abort.abort();
    };
  }, [setStatus, warnOnce, url, data, wasmBaseUrl, scope]);

  return loaded !== null &&
    loaded.url === url &&
    loaded.data === data &&
    loaded.wasmBaseUrl === wasmBaseUrl
    ? loaded
    : null;
}
