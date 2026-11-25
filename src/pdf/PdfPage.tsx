/**
 * One mounted PDF page: its canvas and render lifecycle. Ported from
 * OpenContracts' `PDFPage` (`renderers/pdf/PDFPage.tsx`, 98286cabf) without
 * its layers (selection, links, annotations, search / chat / text-block
 * results) and without the initial fit-to-width zoom, which the format's
 * driver resolves for the shell (`resolveFitWidth`).
 *
 * The first render happens on mount; later zoom changes re-render the page
 * at once and again through the viewport's shared, debounced render queue
 * (`onZoomRenderRequest`), as in OpenContracts.
 */
import { useEffect, useRef, useState } from "react";
import styled from "styled-components";

import { useSetDocumentStatus, useZoom } from "../core/index";
import { isRenderingCancelled, PdfPageRenderer } from "./PdfPageRenderer";
import type { PDFPageInfo } from "./PDFPageInfo";

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
}

function toError(reason: unknown): Error {
  return reason instanceof Error ? reason : new Error(String(reason));
}

export function PdfPage({ pageInfo, onZoomRenderRequest }: PdfPageProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<PdfPageRenderer | null>(null);
  const pageContainerRef = useRef<HTMLDivElement>(null);
  const zoomLevel = useZoom();
  const setStatus = useSetDocumentStatus();
  const [hasPdfPageRendered, setPdfPageRendered] = useState(false);
  const pageNumber = pageInfo.page.pageNumber;

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
    <PageAnnotationsContainer
      ref={pageContainerRef}
      data-rca-page={pageNumber - 1}
    >
      <CanvasWrapper>
        <PageCanvas ref={canvasRef} />
      </CanvasWrapper>
    </PageAnnotationsContainer>
  );
}
