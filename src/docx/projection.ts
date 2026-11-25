/**
 * What docxodus projects onto the converted HTML: the visible span
 * annotations, the span highlights and the pending selection, as one
 * `ExternalAnnotationSet`. Ported from OpenContracts'
 * `buildExternalAnnotationSet` (`renderers/docx/DocxAnnotator.tsx`,
 * 98286cabf).
 *
 * Changed from OpenContracts: search results and chat sources are one kind,
 * highlights, under the synthetic labels `__highlight__` and (the active one)
 * `__highlight_active__`; the pending selection is projected too (under
 * `__pending__`), so it stays painted once the native selection is gone;
 * the caller applies the display filters (the structural filter here is
 * gone), and no entry is marked `structural`, which made docxodus skip it,
 * so structural annotations were never drawn; an entry whose offsets do not
 * name a non-empty range of `text` is dropped; an entry's text is the slice
 * of `text` its offsets name rather
 * than the host's `rawText` (docxodus anchors an annotation by that text, and
 * `rawText` is optional); label colours are the PDF format's (`labelColor`);
 * and the set is deterministic (no timestamps), so equal input projects to
 * an equal set.
 */
import type {
  AnnotationLabel as DocxodusLabel,
  ExternalAnnotationSet,
} from "docxodus";

import { labelColor, TEXT_BLOCK_HIGHLIGHT_COLOR } from "../core/index";
import type {
  AnnotationLabel,
  Highlight,
  InternalAnnotation,
  SpanAnnotationJson,
} from "../core/index";
import {
  ACTIVE_HIGHLIGHT_LABEL_ID,
  HIGHLIGHT_LABEL_ID,
  PENDING_COLOR,
  PENDING_ENTRY_ID,
  PENDING_LABEL_ID,
} from "./constants";

type Entry = ExternalAnnotationSet["labelledText"][number];

export interface ProjectionInput {
  /** The document text the offsets index into. */
  text: string;
  /** What to draw; only span annotations are projected. */
  annotations: readonly InternalAnnotation[];
  /** Only span highlights are projected. */
  highlights: readonly Highlight[];
  activeHighlightId: string | null;
  /** The pending selection's offsets, or null. */
  pending?: SpanAnnotationJson | null;
}

/** True when the offsets name a non-empty range of `text`. */
export function isDrawableSpan(
  { start, end }: SpanAnnotationJson,
  text: string
): boolean {
  return (
    Number.isInteger(start) &&
    Number.isInteger(end) &&
    start >= 0 &&
    start < end &&
    end <= text.length
  );
}

function entry(
  id: string,
  labelId: string,
  { start, end }: SpanAnnotationJson,
  text: string,
  structural = false
): Entry {
  const slice = text.slice(start, end);
  return {
    id,
    annotationLabel: labelId,
    rawText: slice,
    page: 0,
    annotationJson: { start, end, text: slice },
    annotationType: structural ? "structural" : "text",
    // docxodus (12.4.1) projects nothing marked structural. Whether a
    // structural annotation is drawn is the display filters' decision, taken
    // before projection, so the entry never carries the flag.
    structural: false,
  };
}

/** A label record for docxodus. */
function docxodusLabel(id: string, text: string, color: string): DocxodusLabel {
  return { id, text, color, description: "", icon: "", labelType: "text" };
}

/** docxodus' record of an annotation label, in the colour it is drawn in. */
export function annotationLabelRecord(label: AnnotationLabel): DocxodusLabel {
  return docxodusLabel(label.id, label.text, labelColor(label));
}

/**
 * A whitespace-only text node that starts with a line break, between two
 * tags. docxodus (12.4.1) indents the HTML it returns from projection, and
 * its converted HTML puts `white-space: pre-wrap` on every span, so that
 * indentation would show: a paragraph that starts with an annotation would
 * get a blank line and an indent. Document text never looks like this (a
 * line break in a run is converted to `<br>`).
 */
const SERIALIZER_INDENTATION = />\n[ \t]*</g;

/** Projected HTML without the indentation docxodus added to it. */
export function withoutIndentation(html: string): string {
  return html.replace(SERIALIZER_INDENTATION, "><");
}

export function buildProjectionSet({
  text,
  annotations,
  highlights,
  activeHighlightId,
  pending = null,
}: ProjectionInput): ExternalAnnotationSet {
  const labelledText: Entry[] = [];
  const textLabels: Record<string, DocxodusLabel> = {};

  for (const annotation of annotations) {
    if (annotation.kind !== "span" || !isDrawableSpan(annotation.json, text)) {
      continue;
    }
    const label = annotation.annotationLabel;
    labelledText.push(
      entry(
        annotation.id,
        label.id,
        annotation.json,
        text,
        annotation.structural
      )
    );
    textLabels[label.id] ??= annotationLabelRecord(label);
  }

  for (const highlight of highlights) {
    const { target } = highlight;
    if (target.kind !== "span" || !isDrawableSpan(target, text)) continue;
    const labelId =
      highlight.id === activeHighlightId
        ? ACTIVE_HIGHLIGHT_LABEL_ID
        : HIGHLIGHT_LABEL_ID;
    labelledText.push(entry(highlight.id, labelId, target, text));
    // One colour per synthetic label; each highlight's own colour is set by
    // the generated CSS (see `styles.ts`).
    textLabels[labelId] ??= docxodusLabel(
      labelId,
      "",
      TEXT_BLOCK_HIGHLIGHT_COLOR
    );
  }

  if (pending && isDrawableSpan(pending, text)) {
    labelledText.push(entry(PENDING_ENTRY_ID, PENDING_LABEL_ID, pending, text));
    textLabels[PENDING_LABEL_ID] = docxodusLabel(
      PENDING_LABEL_ID,
      "",
      PENDING_COLOR
    );
  }

  return {
    title: "",
    content: text,
    pageCount: 1,
    pawlsFileContent: [],
    docLabels: [],
    labelledText,
    textLabels,
    docLabelDefinitions: {},
    documentId: "",
    documentHash: "",
    createdAt: "",
    updatedAt: "",
    version: "1.0",
  };
}
