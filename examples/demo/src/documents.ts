/**
 * The two documents of the demo, fetched from `/fixtures/**` (served by the
 * Vite config from the repository's `fixtures/` directory): an agreement as a
 * PDF with its PAWLS tokens, and a short DOCX with its plain text. Each comes
 * with the OpenContracts annotations (and relations) that go with it.
 */
import type {
  Annotation,
  DocumentInput,
  Relation,
} from "@os-legal/react-contract-annotate";

export type Format = DocumentInput["format"];

export interface DemoDocument {
  document: DocumentInput;
  annotations: Annotation[];
  relations: Relation[];
}

const BASE = import.meta.env.BASE_URL;

/** Where the viewer finds docxodus' WebAssembly runtime (see vite.config.ts). */
const WASM_BASE_URL = `${BASE}docxodus-wasm/`;

async function fetchOk(path: string): Promise<Response> {
  const response = await fetch(`${BASE}fixtures/${path}`);
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  return response;
}

export async function loadDemoDocument(format: Format): Promise<DemoDocument> {
  if (format === "pdf") {
    const [pawls, annotations, relations] = await Promise.all([
      fetchOk("eton/pawls.json").then((r) => r.json()),
      fetchOk("eton/annotations.json").then((r) => r.json()),
      fetchOk("eton/relations.json").then((r) => r.json()),
    ]);
    return {
      document: {
        format,
        source: { url: `${BASE}fixtures/eton/eton-agreement.pdf` },
        pawls,
      },
      annotations,
      relations,
    };
  }
  const [text, annotations] = await Promise.all([
    fetchOk("docx/text.txt").then((r) => r.text()),
    fetchOk("docx/annotations.json").then((r) => r.json()),
  ]);
  return {
    document: {
      format,
      source: { url: `${BASE}fixtures/docx/test.docx` },
      text,
      wasmBaseUrl: WASM_BASE_URL,
    },
    annotations,
    relations: [],
  };
}
