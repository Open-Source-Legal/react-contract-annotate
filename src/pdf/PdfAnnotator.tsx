/**
 * The PDF annotator: `AnnotatorShell` with the PDF format inside. The format
 * loads the document (`usePdfDocument`), holds its pages and provides them
 * to its components (`PdfPagesContext`), holds the text-selection gesture
 * shared by its pages (`PdfDragProvider`), lays the pages out in the
 * virtualised viewport and registers the driver the shell answers the format
 * half of the handle with.
 */
import { forwardRef, useLayoutEffect, useMemo, useRef } from "react";
import type { ForwardedRef, ReactElement, RefAttributes } from "react";

import {
  AnnotatorShell,
  computeFitToWidthZoom,
  useAllAnnotations,
  useHighlights,
  useNotifyDrawabilityChanged,
  useNotifyFitWidthChanged,
  useRegisterFormatDriver,
  useRootElement,
} from "../core/index";
import type {
  AnnotatorHandle,
  PawlsInput,
  PdfAnnotatorProps,
} from "../core/index";
import { PdfDragProvider } from "./dragState";
import { PdfPagesContext, usePdfDocument } from "./loader";
import type { PdfSource } from "./loader";
import type { PDFPageInfo } from "./PDFPageInfo";
import { PdfViewport } from "./PdfViewport";
import type { PdfViewportControls } from "./PdfViewport";
import { scrollTargetPage } from "./scrollTargetPage";
import { buildSearchIndex, findTokenMatches } from "./textSearch";

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

/** The zoom at which page 1 fills the root's width; null until measurable. */
function fitWidthZoom(
  pages: readonly PDFPageInfo[],
  root: HTMLElement | null
): number | null {
  if (pages.length === 0 || !root) return null;
  const naturalWidth = pages[0].page.getViewport({ scale: 1 }).width;
  return computeFitToWidthZoom(naturalWidth, root.clientWidth);
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
  const highlights = useHighlights();
  const root = useRootElement();
  const viewport = useRef<PdfViewportControls | null>(null);

  // The text of the document as its tokens spell it: what `getText()` returns
  // and `findText()` searches. Rebuilt with the pages.
  const searchIndex = useMemo(() => buildSearchIndex(pages), [pages]);

  // The driver reads the pages, annotations, highlights and search index at
  // call time, through refs updated before any effect of the shell can call
  // it.
  const pagesRef = useRef(pages);
  const annotationsRef = useRef(annotations);
  const highlightsRef = useRef(highlights);
  const searchIndexRef = useRef(searchIndex);
  useLayoutEffect(() => {
    pagesRef.current = pages;
    annotationsRef.current = annotations;
    highlightsRef.current = highlights;
    searchIndexRef.current = searchIndex;
  });
  const currentPages = () => pagesRef.current;
  useRegisterFormatDriver({
    kind: "token",
    getPageCount: () => currentPages().length || null,
    getVisiblePageRange: () => viewport.current?.getVisiblePageRange() ?? null,
    getText: () => searchIndexRef.current.text,
    findText: (query, opts) =>
      findTokenMatches(searchIndexRef.current, query, opts),
    scrollToPage: (pageIndex, behavior) =>
      viewport.current?.scrollToPage(pageIndex, behavior) ?? false,
    resolveFitWidth: () => fitWidthZoom(currentPages(), root),
    canDraw: (target) =>
      scrollTargetPage(
        target,
        annotationsRef.current,
        highlightsRef.current,
        currentPages()
      ) !== null,
  });

  // What is drawable depends on the pages (a highlight needs its tokens or
  // bounds on them) and on the highlights: tell the shell when either
  // changes (pages loaded, rebuilt with new PAWLs, or gone), after the refs
  // above have them. A change of the annotations the shell notices itself.
  const notifyDrawabilityChanged = useNotifyDrawabilityChanged();
  useLayoutEffect(() => {
    notifyDrawabilityChanged();
  }, [pages, highlights, notifyDrawabilityChanged]);

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
      <PdfDragProvider pages={pages}>
        <PdfViewport
          controlsRef={viewport}
          onVisiblePagesChange={onVisiblePagesChange}
          enableNativeLinks={enableNativeLinks !== false}
        />
      </PdfDragProvider>
    </PdfPagesContext.Provider>
  );
}
