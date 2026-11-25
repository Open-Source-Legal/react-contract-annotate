/**
 * The PDF annotator: `AnnotatorShell` with the PDF format inside. The format
 * loads the document (`usePdfDocument`), lays its pages out in the
 * virtualised viewport and registers the driver the shell answers the
 * format half of the handle with.
 */
import { forwardRef, useLayoutEffect, useRef } from "react";
import type { ForwardedRef, ReactElement, RefAttributes } from "react";

import {
  AnnotatorShell,
  computeFitToWidthZoom,
  useAnnotatorStore,
  useNotifyFitWidthChanged,
  useRegisterFormatDriver,
  useRootElement,
} from "../core/index";
import type {
  AnnotatorHandle,
  PawlsInput,
  PdfAnnotatorProps,
  ScrollTarget,
} from "../core/index";
import { pdfPagesAtom, usePdfDocument, usePdfPages } from "./loader";
import type { PdfSource } from "./loader";
import type { PDFPageInfo } from "./PDFPageInfo";
import { PdfViewport } from "./PdfViewport";
import type { PdfViewportControls } from "./PdfViewport";

function PdfAnnotatorWithRef<M>(
  props: PdfAnnotatorProps<M>,
  ref: ForwardedRef<AnnotatorHandle>
) {
  const { source, pawls, ...common } = props;
  return (
    <AnnotatorShell common={common} handleRef={ref}>
      <PdfFormat
        source={source}
        pawls={pawls}
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
 * Whether this format can draw `target` now. It is asked before a scroll to
 * an annotation or highlight; nothing is drawable while the format renders
 * neither annotations nor highlights.
 */
function canDraw(_target: ScrollTarget): boolean {
  return false;
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
  onVisiblePagesChange?: (range: [number, number]) => void;
}

function PdfFormat({ source, pawls, onVisiblePagesChange }: PdfFormatProps) {
  usePdfDocument(source, pawls);
  const store = useAnnotatorStore("PdfAnnotator");
  const pages = usePdfPages();
  const root = useRootElement();
  const viewport = useRef<PdfViewportControls | null>(null);

  // Read at call time: the shell may ask between a store change and the
  // render that would hand it a new driver.
  const currentPages = () => store.get(pdfPagesAtom);
  useRegisterFormatDriver({
    kind: "token",
    getPageCount: () => currentPages().length || null,
    getVisiblePageRange: () => viewport.current?.getVisiblePageRange() ?? null,
    getText: () => documentText(currentPages()),
    findText: () => [],
    scrollToPage: (pageIndex, behavior) =>
      viewport.current?.scrollToPage(pageIndex, behavior) ?? false,
    resolveFitWidth: () => fitWidthZoom(currentPages(), root),
    canDraw,
  });

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
    <PdfViewport
      controlsRef={viewport}
      onVisiblePagesChange={onVisiblePagesChange}
    />
  );
}
