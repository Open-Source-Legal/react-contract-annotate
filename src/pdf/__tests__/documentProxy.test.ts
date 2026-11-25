// Type-level: checked by `yarn typecheck` (tsc), a no-op when Vitest runs it.
import type { PDFDocumentProxy } from "pdfjs-dist/types/src/display/api";

import type { PdfAnnotatorProps, PdfDocumentProxyLike } from "../../core/index";

test("a pdf.js PDFDocumentProxy is assignable to the core PdfDocumentProxyLike", () => {
  expectTypeOf<PDFDocumentProxy>().toExtend<PdfDocumentProxyLike>();
  expectTypeOf<{ document: PDFDocumentProxy }>().toExtend<
    PdfAnnotatorProps["source"]
  >();
});
