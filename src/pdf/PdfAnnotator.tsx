/**
 * The PDF annotator: `AnnotatorShell` with the PDF format inside. The format
 * loads the document (`usePdfDocument`), holds its pages and provides them
 * to its components (`PdfPagesContext`), lays them out in the virtualised
 * viewport and registers the driver the shell answers the format half of the
 * handle with.
 */
import { forwardRef, useLayoutEffect, useRef } from "react";
import type { ForwardedRef, ReactElement, RefAttributes } from "react";

import {
  AnnotatorShell,
  annotationPages,
  computeFitToWidthZoom,
  useAllAnnotations,
  useNotifyDrawabilityChanged,
  useNotifyFitWidthChanged,
  useRegisterFormatDriver,
  useRootElement,
} from "../core/index";
import type {
  AnnotatorHandle,
  InternalAnnotation,
  PawlsInput,
  PdfAnnotatorProps,
  ScrollTarget,
} from "../core/index";
import { PdfPagesContext, usePdfDocument } from "./loader";
import type { PdfSource } from "./loader";
import type { PDFPageInfo } from "./PDFPageInfo";
import { PdfViewport } from "./PdfViewport";
import type { PdfViewportControls } from "./PdfViewport";

function PdfAnnotatorWithRef<M>(
  props: PdfAnnotatorProps<M>,
  ref: ForwardedRef<AnnotatorHandle>
) {
  const { source, pawls, enableNativeLinks, ...common } = props;
  return (
    <AnnotatorShell common={common} handleRef={ref}>
      <PdfFormat
        source={source}
        pawls={pawls}
        enableNativeLinks={enableNativeLinks}
        onVisiblePagesChange={common.onVisiblePagesChange}
      />
    </AnnotatorShell>
  );
}

/**
 * Renders a PDF with OpenContracts annotations. Loads `source` itself
 * (`configurePdfWorker` must have been called once); see `PdfAnnotatorProps`.
 */
export const PdfAnnotator = forwardRef(PdfAnnotatorWithRef) as <M = unknown>(
  props: PdfAnnotatorProps<M> & RefAttributes<AnnotatorHandle>
) => ReactElement | null;

/**
 * Whether this format can draw `target` now: an annotation is drawable once
 * it is a token annotation whose first page is one of the document's pages.
 * The display filters are not consulted, so `scrollToAnnotation(id,
 * { select: true })` can reveal a hidden annotation. Highlights are not
 * drawn yet.
 */
function canDraw(
  target: ScrollTarget,
  annotations: readonly InternalAnnotation[],
  pageCount: number
): boolean {
  if (target.kind !== "annotation") return false;
  const annotation = annotations.find((a) => a.id === target.id);
  if (annotation?.kind !== "token") return false;
  const firstPage = annotationPages(annotation)[0];
  return firstPage !== undefined && firstPage < pageCount;
}

/** The zoom at which page 1 fills the root's width; null until measurable. */
function fitWidthZoom(
  pages: readonly PDFPageInfo[],
  root: HTMLElement | null
): number | null {
  if (pages.length === 0 || !root) return null;
  const naturalWidth = pages[0].page.getViewport({ scale: 1 }).width;
  return computeFitToWidthZoom(naturalWidth, root.clientWidth);
}

/** Each page's token texts joined with spaces, page after page. */
function documentText(pages: readonly PDFPageInfo[]): string {
  return pages
    .map((info) =>
      info.tokens
        .map((token) => token.text ?? "")
        .filter((text) => text !== "")
        .join(" ")
    )
    .filter((text) => text !== "")
    .join(" ");
}

interface PdfFormatProps {
  source: PdfSource;
  pawls: PawlsInput | null | undefined;
  enableNativeLinks: boolean | undefined;
  onVisiblePagesChange?: (range: [number, number]) => void;
}

function PdfFormat({
  source,
  pawls,
  enableNativeLinks,
  onVisiblePagesChange,
}: PdfFormatProps) {
  const pages = usePdfDocument(source, pawls);
  const annotations = useAllAnnotations();
  const root = useRootElement();
  const viewport = useRef<PdfViewportControls | null>(null);

  // The driver reads the pages and annotations at call time, through refs
  // updated before any effect of the shell can call it.
  const pagesRef = useRef(pages);
  const annotationsRef = useRef(annotations);
  useLayoutEffect(() => {
    pagesRef.current = pages;
    annotationsRef.current = annotations;
  });
  const currentPages = () => pagesRef.current;
  useRegisterFormatDriver({
    kind: "token",
    getPageCount: () => currentPages().length || null,
    getVisiblePageRange: () => viewport.current?.getVisiblePageRange() ?? null,
    getText: () => documentText(currentPages()),
    findText: () => [],
    scrollToPage: (pageIndex, behavior) =>
      viewport.current?.scrollToPage(pageIndex, behavior) ?? false,
    resolveFitWidth: () => fitWidthZoom(currentPages(), root),
    canDraw: (target) =>
      canDraw(target, annotationsRef.current, currentPages().length),
  });

  // What is drawable depends on the pages: tell the shell when they change
  // (loaded, rebuilt with new PAWLs, or gone), after the ref above has them.
  // A change of the annotations the shell notices itself.
  const notifyDrawabilityChanged = useNotifyDrawabilityChanged();
  useLayoutEffect(() => {
    notifyDrawabilityChanged();
  }, [pages, notifyDrawabilityChanged]);

  // The fit-to-width zoom becomes measurable once the pages are in and the
  // root has a width. Tell the shell when the pages arrive, and, while the
  // root has no width yet (mounted hidden), again once it gets one.
  const notifyFitWidthChanged = useNotifyFitWidthChanged();
  useLayoutEffect(() => {
    if (!root || pages.length === 0) return;
    notifyFitWidthChanged();
    if (
      fitWidthZoom(pages, root) !== null ||
      typeof ResizeObserver === "undefined"
    ) {
      return;
    }
    const observer = new ResizeObserver(() => {
      if (fitWidthZoom(pages, root) === null) return;
      observer.disconnect();
      notifyFitWidthChanged();
    });
    observer.observe(root);
    return () => observer.disconnect();
  }, [root, pages, notifyFitWidthChanged]);

  return (
    <PdfPagesContext.Provider value={pages}>
      <PdfViewport
        controlsRef={viewport}
        onVisiblePagesChange={onVisiblePagesChange}
        enableNativeLinks={enableNativeLinks !== false}
      />
    </PdfPagesContext.Provider>
  );
}
