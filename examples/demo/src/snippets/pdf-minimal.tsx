/** README sample: a PDF viewer. Kept here so that it is type-checked. */
import {
  configurePdfWorker,
  PdfAnnotator,
} from "@os-legal/react-contract-annotate/pdf";
import type {
  Annotation,
  PawlsInput,
} from "@os-legal/react-contract-annotate/pdf";
import workerSrc from "pdfjs-dist/legacy/build/pdf.worker.mjs?url";

// Once, before the first viewer mounts.
configurePdfWorker(workerSrc);

export function Contract({
  annotations,
  pawls,
}: {
  annotations: Annotation[];
  pawls: PawlsInput;
}) {
  return (
    // The viewer fills its parent, which must have a height.
    <div style={{ height: 700 }}>
      <PdfAnnotator
        source={{ url: "/contract.pdf" }}
        pawls={pawls}
        annotations={annotations}
      />
    </div>
  );
}
