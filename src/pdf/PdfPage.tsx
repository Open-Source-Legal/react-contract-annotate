/**
 * One mounted PDF page: its canvas and render lifecycle, the native link
 * layer and the annotation boxes. Ported from OpenContracts' `PDFPage`
 * (`renderers/pdf/PDFPage.tsx`, 98286cabf) without its selection layer and
 * its search / chat / text-block results, and without the initial
 * fit-to-width zoom, which the format's driver resolves for the shell
 * (`resolveFitWidth`).
 *
 * The first render happens on mount; later zoom changes re-render the page
 * at once and again through the viewport's shared, debounced render queue
 * (`onZoomRenderRequest`), as in OpenContracts.
 *
 * The page draws every visible token annotation that has bounds on it, and
 * the highlights (`HighlightOverlay`), once its canvas has rendered. It also
 * carries out the last step of a scroll request for an annotation or a
 * highlight first drawn on it: once the box is under the instance root, it
 * scrolls it into view (`centreBox`) and completes the request when that
 * scroll has landed (the viewport has already started scrolling to the
 * page).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import styled from "styled-components";

import {
  useAllAnnotations,
  useHighlights,
  useRootElement,
  useScrollRequest,
  useSetDocumentStatus,
  useVisibleAnnotations,
  useZoom,
} from "../core/index";
import type { ScrollTarget, TokenAnnotation } from "../core/index";
import { AnnotationBox } from "./AnnotationBox";
import { centreBox } from "./centreBox";
import { HighlightOverlay } from "./HighlightOverlay";
import { usePdfPages } from "./loader";
import { NativeLinkLayer } from "./NativeLinkLayer";
import { isRenderingCancelled, PdfPageRenderer } from "./PdfPageRenderer";
import type { PDFPageInfo } from "./PDFPageInfo";
import { scrollTargetPage } from "./scrollTargetPage";

/** Queues a zoom re-render of a page; see `PdfViewport`. */
export type RequestPageRender = (
  pageNumber: number,
  renderer: PdfPageRenderer | null,
  canvas: HTMLCanvasElement | null,
  onComplete?: (zoomLevel: number) => void
) => void;

const PageAnnotationsContainer = styled.div`
  position: relative;
  display: flex;
  justify-content: flex-start;
  align-items: flex-start;
  width: 100%;
  margin: 1rem 0;

  @media (max-width: 768px) {
    margin: 0.5rem 0;
    min-width: fit-content;
    /* Ensure container expands to fit content but allows scrolling */
    width: auto;
    justify-content: flex-start;
  }
`;

/**
 * This wrapper is inline-block (shrink-wrapped) and position:relative
 * so that absolutely-positioned elements inside it match the canvas.
 */
const CanvasWrapper = styled.div`
  position: relative;
  display: inline-block;
`;

// No max-width, so the canvas can exceed its parent's width.
const PageCanvas = styled.canvas`
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
  border: 1px solid rgba(0, 0, 0, 0.1);
`;

export interface PdfPageProps {
  pageInfo: PDFPageInfo;
  onZoomRenderRequest?: RequestPageRender;
  /** Draw the PDF's own links as clickable anchors. Default true. */
  enableNativeLinks?: boolean;
}

function toError(reason: unknown): Error {
  return reason instanceof Error ? reason : new Error(String(reason));
}

/** The attribute that carries the id of what a scroll target is drawn as. */
const TARGET_ATTRIBUTE = {
  annotation: "data-rca-annotation",
  highlight: "data-rca-highlight",
} as const;

/** The box `target` draws on page `pageIndex`, under the root. */
function findBox(
  root: HTMLElement,
  target: ScrollTarget,
  pageIndex: number
): HTMLElement | null {
  const attribute = TARGET_ATTRIBUTE[target.kind];
  const parts = root.querySelectorAll<HTMLElement>(
    `[data-rca-page-part="${pageIndex}"]`
  );
  for (const part of Array.from(parts)) {
    if (part.getAttribute(attribute) === target.id) return part;
  }
  return null;
}

/**
 * The page's part of a scroll request: when the target's first drawn page is
 * this one and the page draws it (an annotation that is visible; a highlight
 * with a box here), scroll its box into view with the request's behaviour as
 * soon as it is under the root (retrying on animation frames while the
 * request is current), and complete the request once that scroll has landed.
 * Annotations and highlights go the same way; only the box differs.
 */
function useCentreScrollTarget(
  pageIndex: number,
  drawn: readonly TokenAnnotation[],
  rendered: boolean
): void {
  const root = useRootElement();
  const pages = usePdfPages();
  const annotations = useAllAnnotations();
  const highlights = useHighlights();
  const { request, complete } = useScrollRequest();
  const target = request?.target;
  const owned =
    target !== undefined &&
    scrollTargetPage(target, annotations, highlights, pages) === pageIndex &&
    (target.kind === "highlight" || drawn.some((a) => a.id === target.id));

  useEffect(() => {
    if (!request || !owned || !rendered || !root) return;
    const { seq, behavior, target: requested } = request;
    let frame = 0;
    let stopWaiting = () => {};
    const attempt = () => {
      const box = findBox(root, requested, pageIndex);
      if (!box) {
        frame = requestAnimationFrame(attempt);
        return;
      }
      stopWaiting = centreBox(root, box, behavior, () => complete(seq, true));
    };
    attempt();
    // A newer request, or this page leaving the window, stops the retries
    // and the wait for the scroll to land.
    return () => {
      cancelAnimationFrame(frame);
      stopWaiting();
    };
  }, [request, owned, rendered, root, pageIndex, complete]);
}

export function PdfPage({
  pageInfo,
  onZoomRenderRequest,
  enableNativeLinks = true,
}: PdfPageProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<PdfPageRenderer | null>(null);
  const pageContainerRef = useRef<HTMLDivElement>(null);
  const zoomLevel = useZoom();
  const setStatus = useSetDocumentStatus();
  const [hasPdfPageRendered, setPdfPageRendered] = useState(false);
  const pageNumber = pageInfo.page.pageNumber;
  const pageIndex = pageNumber - 1;

  /* the page's tokens at the current zoom, for the boxes */
  const scaledPageInfo = useMemo(
    () => pageInfo.withScale(zoomLevel),
    [pageInfo, zoomLevel]
  );

  /* the visible token annotations with a box on this page */
  const visibleAnnotations = useVisibleAnnotations();
  const drawn = useMemo(
    () =>
      visibleAnnotations.filter(
        (annot): annot is TokenAnnotation =>
          annot.kind === "token" && Boolean(annot.json[pageIndex]?.bounds)
      ),
    [visibleAnnotations, pageIndex]
  );
  useCentreScrollTarget(pageIndex, drawn, hasPdfPageRendered);

  const lastRenderedZoom = useRef<number | null>(null);

  /**
   * Handles resizing of the PDF page canvas using shared coordinated rendering.
   */
  const pendingZoomRef = useRef<number | null>(null);

  const handleResize = () => {
    if (!canvasRef.current || !rendererRef.current) return;

    // Skip if we already have a request pending for this zoom level
    if (pendingZoomRef.current === zoomLevel) return;

    // Skip if already rendered at this zoom level
    if (lastRenderedZoom.current === zoomLevel) return;

    // Use shared render coordination if available
    if (onZoomRenderRequest) {
      // Mark this zoom level as pending
      pendingZoomRef.current = zoomLevel;

      // Delegate to parent for coordinated rendering with callback
      onZoomRenderRequest(
        pageNumber,
        rendererRef.current,
        canvasRef.current,
        (completedZoom: number) => {
          // Update state when render actually completes
          lastRenderedZoom.current = completedZoom;
          // Clear pending if it matches what was rendered
          if (pendingZoomRef.current === completedZoom) {
            pendingZoomRef.current = null;
          }
        }
      );

      // DON'T update lastRenderedZoom here - wait for actual render
    } else {
      // Fallback to immediate render if no coordination
      const viewport = pageInfo.page.getViewport({ scale: zoomLevel });
      canvasRef.current.width = viewport.width;
      canvasRef.current.height = viewport.height;

      rendererRef.current.rescaleAndRender(zoomLevel).catch((err) => {
        // Silently ignore cancellation errors - these are normal during zoom changes
        if (!isRenderingCancelled(err)) {
          console.error(`Page ${pageNumber} render error:`, err);
        }
      });
      lastRenderedZoom.current = zoomLevel;
    }
  };

  useEffect(() => {
    if (!hasPdfPageRendered && canvasRef.current && pageContainerRef.current) {
      let cancelled = false;
      const initializePage = async () => {
        try {
          if (pageContainerRef.current && canvasRef.current) {
            rendererRef.current = new PdfPageRenderer(
              pageInfo.page,
              canvasRef.current
            );

            // Get viewport with desired zoom level
            const viewport = pageInfo.page.getViewport({ scale: zoomLevel });

            // Set canvas dimensions to match viewport
            canvasRef.current.width = viewport.width;
            canvasRef.current.height = viewport.height;

            await rendererRef.current.render(zoomLevel);
            if (cancelled) return;

            lastRenderedZoom.current = zoomLevel;
            setPdfPageRendered(true);
          }
        } catch (error) {
          // A render cancelled by this effect's cleanup (a zoom change or
          // the page leaving the window mid-render) is not a failure.
          if (cancelled || isRenderingCancelled(error)) return;
          setStatus({ state: "error", error: toError(error) });
        }
      };
      void initializePage();

      return () => {
        cancelled = true;
        // Cancel any in-progress render
        if (rendererRef.current) {
          rendererRef.current.cancelCurrentRender();
        }
      };
    } else if (
      hasPdfPageRendered &&
      canvasRef.current &&
      pageContainerRef.current
    ) {
      handleResize();
    }
    // Keyed on the zoom and the page only, as in OpenContracts: the other
    // values it reads are refs or stable.
  }, [zoomLevel, pageInfo.page]);

  // A render still in progress when the page unmounts is cancelled whichever
  // effect started it.
  useEffect(
    () => () => {
      rendererRef.current?.cancelCurrentRender();
    },
    []
  );

  useEffect(() => {
    if (!hasPdfPageRendered) return; // page not visible yet
    if (!canvasRef.current || !rendererRef.current) return;

    /* only rerender if zoom actually changed */
    if (lastRenderedZoom.current !== zoomLevel) {
      const viewport = pageInfo.page.getViewport({ scale: zoomLevel });
      canvasRef.current.width = viewport.width;
      canvasRef.current.height = viewport.height;

      rendererRef.current.rescaleAndRender(zoomLevel).catch((err) => {
        // Silently ignore cancellation errors - these are normal during zoom changes
        if (!isRenderingCancelled(err)) {
          console.error(`Page ${pageNumber} render error:`, err);
        }
      });
      lastRenderedZoom.current = zoomLevel;
    }
  }, [zoomLevel, hasPdfPageRendered, pageInfo.page, pageNumber]);

  return (
    <PageAnnotationsContainer ref={pageContainerRef} data-rca-page={pageIndex}>
      <CanvasWrapper>
        <PageCanvas ref={canvasRef} />
        {hasPdfPageRendered && enableNativeLinks && (
          <NativeLinkLayer page={pageInfo.page} scale={zoomLevel} />
        )}
        {hasPdfPageRendered && <HighlightOverlay pageInfo={scaledPageInfo} />}
        {hasPdfPageRendered &&
          drawn.map((annotation) => (
            <AnnotationBox
              key={annotation.id}
              annotation={annotation}
              pageInfo={scaledPageInfo}
            />
          ))}
      </CanvasWrapper>
    </PageAnnotationsContainer>
  );
}
