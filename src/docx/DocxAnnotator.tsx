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
 *
 * A target is drawable once the document is shown, is a span within the
 * text, and was not left undrawn by the last projection laid out (docxodus
 * draws one of two overlapping spans; see `projection.ts`). An annotation the
 * display filters hide counts as drawable, so `scrollToAnnotation(id,
 * { select: true })` can reveal it.
 */
import {
  forwardRef,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { ForwardedRef, ReactElement, RefAttributes } from "react";

import {
  AnnotatorShell,
  useAllAnnotations,
  useDevWarnOnce,
  useDocumentStatus,
  useHighlights,
  useNotifyDrawabilityChanged,
  useReadDocumentData,
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
import { findSpanMatches, isDrawableSpan } from "./docxOffsetUtils";
import { createDocxScope } from "./isolation";
import { useDocxDocument } from "./loader";
import type { DocxSource } from "./loader";
import type { TargetIds } from "./projection";
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
  // Random, so it is unique across React roots too (unlike `useId`).
  const [scope] = useState(createDocxScope);
  const docx = useDocxDocument(source, wasmBaseUrl, scope);
  const ready = useDocumentStatus().state === "ready";
  /** What the last projection laid out did not draw (`DocxView`). */
  const suppressedRef = useRef<TargetIds | null>(null);
  const highlights = useHighlights();
  const readData = useReadDocumentData();
  useUnsupportedWarnings(hasSelectedRelations);

  // The driver reads the annotations and highlights from the store when it
  // is called (they may have arrived in this very commit), and the text and
  // readiness through a ref updated before any effect of the shell can call
  // it.
  const latest = useRef({ text, ready });
  useLayoutEffect(() => {
    latest.current = { text, ready };
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
    canDraw: (target) => {
      if (!latest.current.ready) return false;
      const data = readData();
      return (
        drawable(target, data.annotations, data.highlights, latest.current.text) &&
        !suppressedRef.current?.[target.kind].has(target.id)
      );
    },
  });

  // What is drawable depends on the text and the highlights, and on the
  // document being shown: tell the shell when any changes, after the refs
  // above have them. A change of the annotations the shell notices itself;
  // `DocxView` tells it after each layout.
  const notifyDrawabilityChanged = useNotifyDrawabilityChanged();
  useLayoutEffect(() => {
    notifyDrawabilityChanged();
  }, [text, highlights, ready, notifyDrawabilityChanged]);

  return (
    <DocxView
      docx={docx}
      text={text}
      scope={scope}
      suppressedRef={suppressedRef}
    />
  );
}
