/**
 * The DOCX annotator: `AnnotatorShell` with the DOCX format inside. The
 * format loads and converts the document (`useDocxDocument`), shows it
 * (`DocxView`), registers the driver the shell answers the format half of the
 * handle with, and warns once in development about what it accepts but
 * cannot draw.
 *
 * The document is not paginated for the handle: `getPageCount()` and
 * `getVisiblePageRange()` are null and `scrollToPage()` is false. Zoom is the
 * view's scale factor, and fit-to-width is 1. `getText()` is the `text` prop
 * and `findText()` searches it.
 */
import { forwardRef, useEffect, useLayoutEffect, useRef } from "react";
import type { ForwardedRef, ReactElement, RefAttributes } from "react";

import {
  AnnotatorShell,
  useAllAnnotations,
  useDevWarnOnce,
  useDocumentStatus,
  useHighlights,
  useNotifyDrawabilityChanged,
  useRegisterFormatDriver,
  useRenderAnnotationActions,
} from "../core/index";
import type {
  AnnotatorHandle,
  DocxAnnotatorProps,
  Highlight,
  InternalAnnotation,
  ScrollTarget,
} from "../core/index";
import { findSpanMatches } from "./docxOffsetUtils";
import { useDocxDocument } from "./loader";
import type { DocxSource } from "./loader";
import { isDrawableSpan } from "./projection";
import { DocxView } from "./DocxView";

function DocxAnnotatorWithRef<M>(
  props: DocxAnnotatorProps<M>,
  ref: ForwardedRef<AnnotatorHandle>
) {
  const { source, text, wasmBaseUrl, ...common } = props;
  return (
    <AnnotatorShell common={common} handleRef={ref}>
      <DocxFormat
        source={source}
        text={text}
        wasmBaseUrl={wasmBaseUrl}
        hasSelectedRelations={(common.selectedRelationIds?.length ?? 0) > 0}
      />
    </AnnotatorShell>
  );
}

/**
 * Renders a DOCX with OpenContracts span annotations. Loads `source` itself
 * with docxodus, whose WebAssembly runtime the host serves at `wasmBaseUrl`;
 * see `DocxAnnotatorProps`.
 */
export const DocxAnnotator = forwardRef(DocxAnnotatorWithRef) as <M = unknown>(
  props: DocxAnnotatorProps<M> & RefAttributes<AnnotatorHandle>
) => ReactElement | null;

/** Whether this format can draw the target: a span within `text`. */
function drawable(
  target: ScrollTarget,
  annotations: readonly InternalAnnotation[],
  highlights: readonly Highlight[],
  text: string
): boolean {
  if (target.kind === "highlight") {
    const highlight = highlights.find((h) => h.id === target.id);
    return (
      highlight?.target.kind === "span" &&
      isDrawableSpan(highlight.target, text)
    );
  }
  const annotation = annotations.find((a) => a.id === target.id);
  return annotation?.kind === "span" && isDrawableSpan(annotation.json, text);
}

/** Development warnings: what DOCX accepts but does not draw. */
const WARNINGS = {
  annotationActions:
    "renderAnnotationActions is not supported by the DOCX annotator (its " +
    "label chip is a CSS ::before, not an element); it is ignored.",
  relationBadges:
    "The DOCX annotator shows the endpoints of selectedRelationIds but draws " +
    "no SOURCE / TARGET badges.",
  reviewState:
    "The DOCX annotator does not style approved or rejected annotations; " +
    "they are drawn as ordinary annotations.",
  links:
    "The DOCX annotator does not open linkUrl annotations on click; they are " +
    "drawn as ordinary annotations.",
  tokenAnnotations:
    "The DOCX annotator cannot draw token annotations (PDF annotation JSON); " +
    "they are ignored. Use { start, end } JSON for a DOCX.",
  pdfHighlights:
    'The DOCX annotator cannot draw highlights whose target.kind is "tokens" ' +
    'or "bounds" (they belong to a PDF); they are ignored. Use "span" ' +
    "targets for a DOCX.",
} as const;

function useUnsupportedWarnings(hasSelectedRelations: boolean): void {
  const warnOnce = useDevWarnOnce();
  const annotations = useAllAnnotations();
  const highlights = useHighlights();
  const hasAnnotationActions = useRenderAnnotationActions() !== undefined;

  const found = {
    annotationActions: hasAnnotationActions,
    relationBadges: hasSelectedRelations,
    reviewState: annotations.some((a) => a.approved || a.rejected),
    links: annotations.some((a) => Boolean(a.linkUrl)),
    tokenAnnotations: annotations.some((a) => a.kind !== "span"),
    pdfHighlights: highlights.some((h) => h.target.kind !== "span"),
  };
  const key = (Object.keys(found) as (keyof typeof WARNINGS)[])
    .filter((name) => found[name])
    .join(",");

  useEffect(() => {
    if (key === "") return;
    for (const name of key.split(",") as (keyof typeof WARNINGS)[]) {
      warnOnce(`docx-${name}`, WARNINGS[name]);
    }
  }, [key, warnOnce]);
}

interface DocxFormatProps {
  source: DocxSource;
  text: string;
  wasmBaseUrl: string;
  hasSelectedRelations: boolean;
}

function DocxFormat({
  source,
  text,
  wasmBaseUrl,
  hasSelectedRelations,
}: DocxFormatProps) {
  const docx = useDocxDocument(source, wasmBaseUrl);
  const ready = useDocumentStatus().state === "ready";
  const annotations = useAllAnnotations();
  const highlights = useHighlights();
  useUnsupportedWarnings(hasSelectedRelations);

  // The driver reads these at call time, through refs updated before any
  // effect of the shell can call it.
  const latest = useRef({ text, ready, annotations, highlights });
  useLayoutEffect(() => {
    latest.current = { text, ready, annotations, highlights };
  });
  useRegisterFormatDriver({
    kind: "span",
    getPageCount: () => null,
    getVisiblePageRange: () => null,
    getText: () => latest.current.text,
    findText: (query, opts) =>
      findSpanMatches(latest.current.text, query, opts),
    scrollToPage: () => false,
    resolveFitWidth: () => 1,
    // Drawable once the document is shown (whatever the display filters
    // say, so `scrollToAnnotation(id, { select: true })` can reveal a hidden
    // annotation).
    canDraw: (target) =>
      latest.current.ready &&
      drawable(
        target,
        latest.current.annotations,
        latest.current.highlights,
        latest.current.text
      ),
  });

  // What is drawable depends on the text and the highlights, and on the
  // document being shown: tell the shell when any changes, after the refs
  // above have them. A change of the annotations the shell notices itself.
  const notifyDrawabilityChanged = useNotifyDrawabilityChanged();
  useLayoutEffect(() => {
    notifyDrawabilityChanged();
  }, [text, highlights, ready, notifyDrawabilityChanged]);

  return <DocxView docx={docx} text={text} />;
}
