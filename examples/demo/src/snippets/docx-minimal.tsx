/** README sample: a DOCX viewer. Kept here so that it is type-checked. */
import { DocxAnnotator } from "@os-legal/react-contract-annotate/docx";
import type { Annotation } from "@os-legal/react-contract-annotate/docx";

export function Agreement({
  annotations,
  text,
}: {
  annotations: Annotation[];
  /** The parser's plain text; the annotations' `{ start, end }` index into it. */
  text: string;
}) {
  return (
    <div style={{ height: 700 }}>
      <DocxAnnotator
        source={{ url: "/agreement.docx" }}
        text={text}
        wasmBaseUrl="/docxodus-wasm/"
        annotations={annotations}
      />
    </div>
  );
}
