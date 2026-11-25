import { GlobalWorkerOptions } from "pdfjs-dist/legacy/build/pdf.mjs";

/**
 * Tells pdf.js where its worker script is. Call it once, before the first
 * `PdfAnnotator` mounts. The library does not import a worker file itself:
 * the host's bundler emits it and hands back its URL. `GlobalWorkerOptions`
 * belongs to the pdf.js module instance the library loads documents with
 * (`pdfjs-dist/legacy/build/pdf.mjs`), which is why it is set here and not by
 * the host's own pdf.js import.
 *
 * ```ts
 * // Vite
 * import workerSrc from "pdfjs-dist/legacy/build/pdf.worker.mjs?url";
 * configurePdfWorker(workerSrc);
 * ```
 */
export function configurePdfWorker(workerSrc: string): void {
  GlobalWorkerOptions.workerSrc = workerSrc;
}
