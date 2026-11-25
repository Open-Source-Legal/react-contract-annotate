/**
 * Turns the public `Annotation` JSON into the internal shape the renderers
 * draw: v2 compact token JSON is expanded to v1, defaults are filled in, and
 * the annotation is tagged `token` (PDF) or `span` (DOCX).
 */
import {
  expandAnnotationJson,
  isSpanFormat,
} from "./geometry/compactAnnotationJson";
import { sortedPageIndices } from "./geometry/pageIndices";
import type {
  Annotation,
  AnnotationLabel,
  MultipageAnnotationJson,
  SpanAnnotationJson,
} from "./types";

export interface InternalBase {
  id: string;
  annotationLabel: AnnotationLabel;
  rawText: string;
  structural: boolean;
  approved: boolean;
  rejected: boolean;
  linkUrl: string | null;
  /** The caller's own object, handed back unchanged in callbacks. */
  source: Annotation;
}

export interface TokenAnnotation extends InternalBase {
  kind: "token";
  /** 0-based first page. */
  page: number;
  /** Always v1: compact v2 input is expanded. */
  json: MultipageAnnotationJson;
}

export interface SpanAnnotation extends InternalBase {
  kind: "span";
  json: SpanAnnotationJson;
}

export type InternalAnnotation = TokenAnnotation | SpanAnnotation;

/** Normalise one annotation. Pure: every call builds a new object. */
export function normalizeAnnotation(a: Annotation): InternalAnnotation {
  const base: InternalBase = {
    id: a.id,
    annotationLabel: a.annotationLabel,
    rawText: a.rawText ?? "",
    structural: a.structural ?? false,
    approved: a.approved ?? false,
    rejected: a.rejected ?? false,
    linkUrl: a.linkUrl ?? null,
    source: a,
  };

  if (isSpanFormat(a.json)) {
    return { ...base, kind: "span", json: a.json };
  }

  const expanded = expandAnnotationJson(a.json, base.rawText);
  const json: MultipageAnnotationJson =
    expanded && typeof expanded === "object"
      ? (expanded as MultipageAnnotationJson)
      : {};
  // An annotation without any page data still needs a page; 0 is the
  // least surprising choice and draws nothing.
  const page = a.page ?? sortedPageIndices(json)[0] ?? 0;
  return { ...base, kind: "token", page, json };
}

// A pure memo keyed by the identity of the caller's annotation objects, so a
// re-render with the same `annotations` array does not re-expand every
// annotation. It holds no per-instance state; the only requirement is that
// callers treat an annotation as immutable (pass a new object to change one).
const normalized = new WeakMap<Annotation, InternalAnnotation>();

/** Normalise a list, reusing the result for any object seen before. */
export function normalizeAnnotations(list: Annotation[]): InternalAnnotation[] {
  return list.map((a) => {
    let internal = normalized.get(a);
    if (!internal) {
      internal = normalizeAnnotation(a);
      normalized.set(a, internal);
    }
    return internal;
  });
}

/** Ascending 0-based page indices an annotation draws on; `[]` for a span. */
export function annotationPages(a: InternalAnnotation): number[] {
  return a.kind === "token" ? sortedPageIndices(a.json) : [];
}
