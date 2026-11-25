/**
 * The demo's documents (`public/documents/**`): two model agreements of the
 * U.S. National Institutes of Health, one as a PDF and one as a DOCX, each with
 * an OpenContracts document export (tokens or text, annotations and
 * relationships) written by `scripts/make-exports.mjs`, and the labels of the
 * corpus they belong to. `fromOpenContractsExport` turns an export into the
 * viewer's inputs.
 */
import { fromOpenContractsExport } from "@os-legal/react-contract-annotate";
import type {
  Annotation,
  AnnotationLabel,
  DocumentInput,
  OpenContractDocExport,
  OpenContractLabelLookup,
  Relation,
} from "@os-legal/react-contract-annotate";

export type Format = DocumentInput["format"];

/** One document of the demo, before it is loaded. */
export interface DemoSource {
  id: string;
  /** The name on the document switch. */
  name: string;
  format: Format;
  /** Paths under `documents/`. */
  file: string;
  export: string;
  /** Where the file was published. */
  publishedAt: string;
}

export const DEMO_SOURCES: readonly DemoSource[] = [
  {
    id: "patent-license",
    name: "Patent license (PDF)",
    format: "pdf",
    file: "patent-license/nih-patent-license-nonexclusive.pdf",
    export: "patent-license/export.json",
    publishedAt:
      "https://www.techtransfer.nih.gov/sites/default/files/files/Model%20Agreements/NIH_Patent_License_Nonexclusive_model_102015_rev092024.pdf",
  },
  {
    id: "evaluation-license",
    name: "Evaluation license (DOCX)",
    format: "docx",
    file: "evaluation-license/nih-commercial-evaluation-license.docx",
    export: "evaluation-license/export.json",
    publishedAt:
      "https://www.techtransfer.nih.gov/sites/default/files/files/Model%20Agreements/NIH_Commercial_Evaluation_License_model_102015_rev092024.docx",
  },
];

export interface DemoDocument {
  source: DemoSource;
  title: string;
  document: DocumentInput;
  annotations: Annotation[];
  relations: Relation[];
  /** The labels a reader can apply: those of the document's own annotations. */
  labels: AnnotationLabel[];
}

const DOCUMENTS_URL = `${import.meta.env.BASE_URL}documents/`;

/** Where the viewer finds docxodus' WebAssembly runtime (see vite.config.ts). */
const WASM_BASE_URL = `${import.meta.env.BASE_URL}docxodus-wasm/`;

async function fetchJson<T>(path: string): Promise<T> {
  const response = await fetch(DOCUMENTS_URL + path);
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  return (await response.json()) as T;
}

/** Each label of the annotations a reader made, once, in order of first use. */
function appliedLabels(annotations: Annotation[]): AnnotationLabel[] {
  const byId = new Map<string, AnnotationLabel>();
  for (const { annotationLabel, structural } of annotations) {
    if (!structural && !byId.has(annotationLabel.id)) {
      byId.set(annotationLabel.id, annotationLabel);
    }
  }
  return [...byId.values()];
}

export async function loadDemoDocument(
  source: DemoSource
): Promise<DemoDocument> {
  const [exported, labels] = await Promise.all([
    fetchJson<OpenContractDocExport>(source.export),
    fetchJson<OpenContractLabelLookup>("labels.json"),
  ]);
  const { annotations, relations, pawls, text } = fromOpenContractsExport(
    exported,
    labels
  );
  const file = { url: DOCUMENTS_URL + source.file };
  return {
    source,
    title: exported.title,
    document:
      source.format === "pdf"
        ? { format: "pdf", source: file, pawls }
        : { format: "docx", source: file, text, wasmBaseUrl: WASM_BASE_URL },
    annotations,
    relations,
    labels: appliedLabels(annotations),
  };
}
