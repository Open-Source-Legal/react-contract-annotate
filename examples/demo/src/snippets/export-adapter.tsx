/** README sample: an OpenContracts export as input. Kept here so that it is type-checked. */
import { PdfAnnotator } from "@os-legal/react-contract-annotate/pdf";
import { fromOpenContractsExport } from "@os-legal/react-contract-annotate/core";
import type {
  OpenContractDocExport,
  OpenContractLabelLookup,
} from "@os-legal/react-contract-annotate/core";
import { useMemo } from "react";

export function ExportedDocument({
  docExport,
  labels,
  pdfUrl,
}: {
  docExport: OpenContractDocExport;
  /** The corpus' `text_labels`; without it labels are built from their names. */
  labels?: OpenContractLabelLookup;
  pdfUrl: string;
}) {
  // `text` is the same adapter's input for a DOCX viewer.
  const { annotations, relations, pawls } = useMemo(
    () => fromOpenContractsExport(docExport, labels),
    [docExport, labels]
  );
  return (
    <div style={{ height: 700 }}>
      <PdfAnnotator
        source={{ url: pdfUrl }}
        pawls={pawls}
        annotations={annotations}
        relations={relations}
      />
    </div>
  );
}
