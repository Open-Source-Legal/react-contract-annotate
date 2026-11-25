/**
 * What docxodus projects onto the converted HTML: the visible span
 * annotations, the span highlights and the pending selection, as one
 * `ExternalAnnotationSet`. Ported from OpenContracts'
 * `buildExternalAnnotationSet` (`renderers/docx/DocxAnnotator.tsx`,
 * 98286cabf).
 *
 * Overlaps (spec "Overlap rule"). docxodus (12.4.1) never draws two spans
 * that overlap at all: of two spans sharing any text, nested ones included,
 * it draws one (the one starting first) and drops the other, or anchors the
 * other on another occurrence of its text elsewhere in the document. User
 * annotations, highlights and the pending selection take precedence over
 * structural annotations, so a structural span that overlaps any of them is
 * left out (`gaveWay`). Among the others the engine's choice stands; which
 * targets it did not draw is read back from the laid-out document, and
 * reported with those that gave way (`suppressedTargets`).
 *
 * Changed from OpenContracts: search results and chat sources are one kind,
 * highlights, under the synthetic labels `__highlight__` and (the active one)
 * `__highlight_active__`; the pending selection is projected too (under
 * `__pending__`), so it stays painted once the native selection is gone;
 * the caller applies the display filters (the structural filter here is
 * gone), and no entry is marked `structural`, which made docxodus skip it,
 * so structural annotations were never drawn; structural spans give way as
 * above; an entry whose offsets do not name a non-empty range of `text` is
 * dropped; label colours are the PDF format's (`labelColor`); and the set is
 * deterministic (no timestamps), so equal input projects to an equal set.
 * As in OpenContracts, docxodus anchors an annotation by its `rawText`; an
 * annotation without one (it is optional here) is anchored by the text its
 * offsets name. Changed from OpenContracts too: the HTML is handed to
 * docxodus as XML (`projectionSource`) and each anchor text in the HTML's
 * own spelling (`anchoredInHtml`); without the first no annotation was drawn
 * on a document with a line break, a table or an image, and without the
 * second none that crossed runs of different formatting at a space.
 */
import type {
  AnnotationLabel as DocxodusLabel,
  ExternalAnnotationSet,
  TextSpan,
} from "docxodus";

import { highlightColor, labelColor } from "../core/index";
import type {
  AnnotationLabel,
  Highlight,
  InternalAnnotation,
  ScrollTarget,
  SpanAnnotation,
  SpanAnnotationJson,
} from "../core/index";
import {
  ACTIVE_HIGHLIGHT_LABEL_ID,
  HIGHLIGHT_LABEL_ID,
  PENDING_COLOR,
  PENDING_ENTRY_ID,
  PENDING_LABEL_ID,
} from "./constants";
import { isDrawableSpan } from "./docxOffsetUtils";

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


/** What a projected entry (or the element docxodus makes of it) stands for. */
export type EntryKind = "annotation" | "highlight" | "pending";

/** The kind of an entry, from its label id (`data-label-id`). */
export function entryKind(labelId: string | null): EntryKind {
  if (labelId === HIGHLIGHT_LABEL_ID || labelId === ACTIVE_HIGHLIGHT_LABEL_ID) {
    return "highlight";
  }
  return labelId === PENDING_LABEL_ID ? "pending" : "annotation";
}

function entry(
  id: string,
  labelId: string,
  { start, end }: SpanAnnotationJson,
  anchorText: string,
  structural = false
): Entry {
  return {
    id,
    annotationLabel: labelId,
    rawText: anchorText,
    page: 0,
    annotationJson: { start, end, text: anchorText },
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
function annotationLabelRecord(label: AnnotationLabel): DocxodusLabel {
  return docxodusLabel(label.id, label.text, labelColor(label));
}

/** Whether two spans share any text. */
function overlaps(a: SpanAnnotationJson, b: SpanAnnotationJson): boolean {
  return a.start < b.end && b.start < a.end;
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

/** What docxodus' projection is given of a document, besides the set. */
export interface ProjectionSource {
  /** The document's HTML as XML, which the projection parses. */
  markup: string;
  /** The text of that HTML, which the projection searches. */
  text: string;
}

/**
 * `html` as docxodus' projection can read it. The projection parses its
 * input as XML, and HTML writes some elements without an end tag (`<br>`,
 * `<col>`, `<img>`), which XML reads as never closed: with one of them in
 * the document the projection fails and no annotation is drawn. Serialising
 * the parsed HTML as XML writes every element closed, and changes nothing
 * else the projection looks at.
 */
export function projectionSource(html: string): ProjectionSource {
  const template = document.createElement("template");
  template.innerHTML = html;
  const serializer = new XMLSerializer();
  return {
    markup: Array.from(template.content.childNodes, (node) =>
      serializer.serializeToString(node)
    ).join(""),
    text: template.content.textContent ?? "",
  };
}

const NO_BREAK_SPACES = /\u00a0/g;

/** `text` with its no-break spaces as plain ones (the length is the same). */
function withPlainSpaces(text: string): string {
  return text.replace(NO_BREAK_SPACES, " ");
}

/**
 * `set` with each entry's anchor text spelt as the document's HTML spells it.
 * docxodus finds an entry by searching the text of the HTML for its anchor
 * text, character for character, and its converted HTML (12.4.1) writes the
 * space at the start or the end of a run as a no-break space, where the
 * text of the same document (and so an annotation's `rawText`) has a plain
 * space: an annotation that crossed such a run edge was never found, and not
 * drawn. An anchor text found in `htmlText` once the two kinds of space are
 * read alike is replaced by what `htmlText` has there (the first place, which
 * is the one docxodus then finds); one not found even so is left as it is.
 */
export function anchoredInHtml(
  set: ExternalAnnotationSet,
  htmlText: string
): ExternalAnnotationSet {
  const plainHtmlText = withPlainSpaces(htmlText);
  return {
    ...set,
    labelledText: set.labelledText.map((item) => {
      const at = plainHtmlText.indexOf(withPlainSpaces(item.rawText));
      if (at < 0) return item;
      const anchorText = htmlText.slice(at, at + item.rawText.length);
      return anchorText === item.rawText
        ? item
        : {
            ...item,
            rawText: anchorText,
            // Every entry of a projection is a span (see `entry`).
            annotationJson: {
              ...(item.annotationJson as TextSpan),
              text: anchorText,
            },
          };
    }),
  };
}

/** What `buildProjection` makes: the set, and what was left out of it. */
export interface Projection {
  set: ExternalAnnotationSet;
  /**
   * The structural annotations that gave way (see the module comment): they
   * pass the display filters but are never drawn.
   */
  gaveWay: ReadonlySet<string>;
}

export function buildProjection({
  text,
  annotations,
  highlights,
  activeHighlightId,
  pending = null,
}: ProjectionInput): Projection {
  const spans = annotations.filter(
    (a): a is SpanAnnotation =>
      a.kind === "span" && isDrawableSpan(a.json, text)
  );
  const spanHighlights = highlights.flatMap((highlight) => {
    const { target } = highlight;
    return target.kind === "span" && isDrawableSpan(target, text)
      ? [{ highlight, target }]
      : [];
  });
  const pendingSpan = pending && isDrawableSpan(pending, text) ? pending : null;

  // What a structural span gives way to.
  const preferred: SpanAnnotationJson[] = [
    ...spans.filter((a) => !a.structural).map((a) => a.json),
    ...spanHighlights.map(({ target }) => target),
    ...(pendingSpan ? [pendingSpan] : []),
  ];

  const labelledText: Entry[] = [];
  const textLabels: Record<string, DocxodusLabel> = {};
  const gaveWay = new Set<string>();

  for (const annotation of spans) {
    if (
      annotation.structural &&
      preferred.some((span) => overlaps(span, annotation.json))
    ) {
      gaveWay.add(annotation.id);
      continue;
    }
    const label = annotation.annotationLabel;
    const { start, end } = annotation.json;
    labelledText.push(
      entry(
        annotation.id,
        label.id,
        annotation.json,
        annotation.rawText !== "" ? annotation.rawText : text.slice(start, end),
        annotation.structural
      )
    );
    textLabels[label.id] ??= annotationLabelRecord(label);
  }

  for (const { highlight, target } of spanHighlights) {
    const labelId =
      highlight.id === activeHighlightId
        ? ACTIVE_HIGHLIGHT_LABEL_ID
        : HIGHLIGHT_LABEL_ID;
    labelledText.push(
      entry(highlight.id, labelId, target, text.slice(target.start, target.end))
    );
    // One colour per synthetic label (the first highlight's); each
    // highlight's own colour is set by the generated CSS (see `styles.ts`).
    textLabels[labelId] ??= docxodusLabel(
      labelId,
      "",
      highlightColor(highlight)
    );
  }

  if (pendingSpan) {
    labelledText.push(
      entry(
        PENDING_ENTRY_ID,
        PENDING_LABEL_ID,
        pendingSpan,
        text.slice(pendingSpan.start, pendingSpan.end)
      )
    );
    textLabels[PENDING_LABEL_ID] = docxodusLabel(
      PENDING_LABEL_ID,
      "",
      PENDING_COLOR
    );
  }

  const set: ExternalAnnotationSet = {
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
  return { set, gaveWay };
}

/** Ids of annotations and of highlights, kept apart. */
export type TargetIds = Record<ScrollTarget["kind"], ReadonlySet<string>>;

/**
 * The annotations and highlights a projection does not draw though they pass
 * the display filters: the structural annotations that gave way, and the
 * entries of the set whose id `drawn` (the elements the laid-out document
 * holds) has no element of the same kind for.
 */
export function suppressedTargets(
  { set, gaveWay }: Projection,
  drawn: Iterable<{ id: string; labelId: string | null }>
): TargetIds {
  const present = {
    annotation: new Set<string>(),
    highlight: new Set<string>(),
  };
  for (const { id, labelId } of drawn) {
    const kind = entryKind(labelId);
    if (kind !== "pending") present[kind].add(id);
  }
  const missing = {
    annotation: new Set<string>(gaveWay),
    highlight: new Set<string>(),
  };
  for (const { id = "", annotationLabel } of set.labelledText) {
    const kind = entryKind(annotationLabel);
    if (kind !== "pending" && !present[kind].has(id)) missing[kind].add(id);
  }
  return missing;
}
