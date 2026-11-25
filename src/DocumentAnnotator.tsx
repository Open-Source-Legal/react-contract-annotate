/**
 * The root entry's component: picks the PDF or the DOCX annotator by
 * `document.format` and loads that format's chunk on first use, so a host
 * that shows one format never downloads (or evaluates) the other's engine.
 * The two formats are different component types, so a change of format
 * unmounts one viewer and mounts a fresh one with its own private store:
 * nothing (selection, zoom, pending selection) carries over.
 *
 * This is the one module that references both engines, and only through
 * dynamic `import()`; `scripts/check-dist.mjs` verifies the built entries
 * keep that isolation.
 */
import { forwardRef, lazy, Suspense } from "react";
import type { ForwardedRef, ReactElement, RefAttributes } from "react";

import type {
  AnnotatorCommonProps,
  AnnotatorHandle,
  DocumentInput,
} from "./core/index";

const LazyPdfAnnotator = lazy(() =>
  import("./pdf/index").then((m) => ({ default: m.PdfAnnotator }))
);
const LazyDocxAnnotator = lazy(() =>
  import("./docx/index").then((m) => ({ default: m.DocxAnnotator }))
);

export type DocumentAnnotatorProps<M = unknown> = AnnotatorCommonProps<M> & {
  /** The document to show; `format` selects the viewer. */
  document: DocumentInput;
};

function DocumentAnnotatorWithRef<M>(
  props: DocumentAnnotatorProps<M>,
  ref: ForwardedRef<AnnotatorHandle>
) {
  const { document, ...common } = props;
  return (
    // While the format's chunk loads, the host's loading slot stands in for
    // the viewer (progress is not known yet).
    <Suspense fallback={common.renderLoading?.(null) ?? null}>
      {document.format === "pdf" ? (
        <LazyPdfAnnotator
          {...common}
          ref={ref}
          source={document.source}
          pawls={document.pawls}
          enableNativeLinks={document.enableNativeLinks}
        />
      ) : (
        <LazyDocxAnnotator
          {...common}
          ref={ref}
          source={document.source}
          text={document.text}
          wasmBaseUrl={document.wasmBaseUrl}
        />
      )}
    </Suspense>
  );
}

/**
 * Renders a PDF or a DOCX with OpenContracts annotations; see
 * `DocumentAnnotatorProps`. The `ref` is the `AnnotatorHandle` of whichever
 * viewer is mounted. Needs both `pdfjs-dist` and `docxodus` installed; a host
 * that uses one format imports `…/pdf` or `…/docx` instead.
 */
export const DocumentAnnotator = forwardRef(DocumentAnnotatorWithRef) as <
  M = unknown,
>(
  props: DocumentAnnotatorProps<M> & RefAttributes<AnnotatorHandle>
) => ReactElement | null;
