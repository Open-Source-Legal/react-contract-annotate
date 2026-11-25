/**
 * Adapter from OpenContracts' per-document export (`OpenContractDocExport` in
 * `opencontractserver/types/dicts.py`) to the library's plain-JSON inputs.
 * The export names labels (a string) where the library takes label objects, so
 * labels are built from the corpus' `text_labels` map when given and
 * synthesised from the name otherwise.
 */
import type {
  Annotation,
  AnnotationLabel,
  CompactAnnotationJson,
  MultipageAnnotationJson,
  PawlsPage,
  Relation,
  SpanAnnotationJson,
} from "./types";

/** `annotation_json` of an export annotation; a span carries its `text` too. */
export type OpenContractAnnotationJsonExport =
  | MultipageAnnotationJson
  | CompactAnnotationJson
  | (SpanAnnotationJson & { text?: string });

/** One `labelled_text` entry (`OpenContractsAnnotationPythonType`). */
export interface OpenContractAnnotationExport {
  /** Null or absent in an export that was not built from stored rows. */
  id?: string | number | null;
  /** The label's name. */
  annotationLabel: string;
  rawText: string;
  /** 0-based first page. */
  page: number;
  annotation_json: OpenContractAnnotationJsonExport;
  structural: boolean;
  /** Target of an `OC_URL` link annotation. */
  link_url?: string | null;
}

/** One `relationships` entry (`OpenContractsRelationshipPythonType`). */
export interface OpenContractRelationshipExport {
  id?: string | number | null;
  /** The label's name. */
  relationshipLabel: string;
  source_annotation_ids: (string | number)[];
  target_annotation_ids: (string | number)[];
  structural?: boolean;
}

/** A document's export (`OpenContractDocExport`). */
export interface OpenContractDocExport {
  title: string;
  content: string;
  description: string | null;
  pawls_file_content: PawlsPage[];
  page_count: number;
  doc_labels: string[];
  labelled_text: OpenContractAnnotationExport[];
  relationships?: OpenContractRelationshipExport[];
}

/**
 * Labels by name, as the corpus' `text_labels` map holds them. An entry
 * without an `id` is identified by its name.
 */
export type OpenContractLabelLookup = Record<
  string,
  {
    id?: string;
    text: string;
    color?: string;
    description?: string;
    icon?: string;
  }
>;

/** What `fromOpenContractsExport` returns: the inputs of an annotator. */
export interface OpenContractsExportInputs {
  annotations: Annotation[];
  relations: Relation[];
  pawls: PawlsPage[];
  text: string;
}

/**
 * Colours of synthesised labels, picked by a hash of the label name so the
 * same name is the same colour in every call and every viewer.
 */
const SYNTHESISED_LABEL_COLORS: readonly string[] = [
  "#4E79A7",
  "#F28E2B",
  "#E15759",
  "#76B7B2",
  "#59A14F",
  "#EDC948",
  "#B07AA1",
  "#FF9DA7",
  "#9C755F",
  "#1F9E89",
  "#8172B3",
  "#C44E52",
];

const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

/** 32-bit FNV-1a hash of `text`'s UTF-16 code units. */
function hashString(text: string): number {
  let hash = FNV_OFFSET_BASIS;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, FNV_PRIME);
  }
  return hash >>> 0;
}

/** The id as a string, or `fallback()` when the export has none. */
function stringId(
  id: string | number | null | undefined,
  fallback: () => string
): string {
  return id === null || id === undefined || id === "" ? fallback() : String(id);
}

/** Looks a label up by name, builds it once per name per conversion. */
function labelResolver(
  lookup: OpenContractLabelLookup | undefined
): (name: string) => AnnotationLabel {
  const built = new Map<string, AnnotationLabel>();
  return (name) => {
    let label = built.get(name);
    if (!label) {
      const entry =
        lookup && Object.hasOwn(lookup, name) ? lookup[name] : undefined;
      if (entry) {
        label = { id: entry.id ?? name, text: entry.text };
        if (entry.color !== undefined) label.color = entry.color;
        if (entry.description !== undefined) {
          label.description = entry.description;
        }
        if (entry.icon !== undefined) label.icon = entry.icon;
      } else {
        label = {
          id: name,
          text: name,
          color:
            SYNTHESISED_LABEL_COLORS[
              hashString(name) % SYNTHESISED_LABEL_COLORS.length
            ],
        };
      }
      built.set(name, label);
    }
    return label;
  };
}

/**
 * Converts a document's OpenContracts export into the inputs of an annotator:
 * `annotations` and `relations` (ids as strings; an annotation without an id
 * is `ann-<index>`, a relationship `rel-<index>`), the `pawls` pages and the
 * document `text`. `annotation_json` is passed through unchanged.
 *
 * @param labels The corpus' `text_labels` map (label name to label). A name
 *   it lacks, or all names when it is absent, get a label built from the name
 *   with a deterministic colour.
 */
export function fromOpenContractsExport(
  doc: OpenContractDocExport,
  labels?: OpenContractLabelLookup
): OpenContractsExportInputs {
  const labelFor = labelResolver(labels);

  const annotations = doc.labelled_text.map((item, index): Annotation => {
    const annotation: Annotation = {
      id: stringId(item.id, () => `ann-${index}`),
      annotationLabel: labelFor(item.annotationLabel),
      rawText: item.rawText,
      page: item.page,
      json: item.annotation_json,
      structural: item.structural,
    };
    if (item.link_url !== undefined) annotation.linkUrl = item.link_url;
    return annotation;
  });

  const relations = (doc.relationships ?? []).map(
    (item, index): Relation => {
      const relation: Relation = {
        id: stringId(item.id, () => `rel-${index}`),
        label: labelFor(item.relationshipLabel),
        sourceIds: item.source_annotation_ids.map(String),
        targetIds: item.target_annotation_ids.map(String),
      };
      if (item.structural !== undefined) relation.structural = item.structural;
      return relation;
    }
  );

  return {
    annotations,
    relations,
    pawls: doc.pawls_file_content,
    text: doc.content,
  };
}
