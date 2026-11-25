/**
 * The virtualised page column. Ported from OpenContracts' `PDF` component
 * (`renderers/pdf/PDF.tsx`, 98286cabf): every page has an absolutely
 * positioned slot of its height at the current zoom (the page-height cache,
 * with prefix sums for offsets); only the pages in a window around the
 * visible ones (binary search, plus overscan) are mounted; and zoom
 * re-renders of the mounted pages go through one shared debounce.
 *
 * Changed from OpenContracts: the scroll container is the annotator's root
 * (`useRootElement`) instead of `scrollContainerRefAtom`; the window is
 * stretched to keep mounted the pages of every selected annotation, of the
 * active highlight, of the pending scroll request's target and of the
 * pending selection; and the three effects that scrolled on selection,
 * search and chat changes are gone (scrolling is driven by scroll requests).
 *
 * A scroll request for an annotation or a highlight starts here: the
 * viewport scrolls to the page the target is drawn on first, with the
 * request's behaviour (in a layout effect, so it starts before the page's
 * own effect scrolls to the box, which replaces it), then the page completes
 * the request.
 */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { MutableRefObject } from "react";

import {
  annotationPages,
  draftPages,
  highlightPages,
  useActiveHighlightId,
  useAllAnnotations,
  useHighlights,
  usePendingSelection,
  useRootElement,
  useScrollRequest,
  useSelectedAnnotationIds,
  useVisibleAnnotations,
  useZoom,
} from "../core/index";
import {
  PAGE_GAP_PX,
  PAGE_OVERSCAN,
  PAGE_RENDER_DEBOUNCE_MS,
} from "./constants";
import { usePdfPages } from "./loader";
import { PdfPage } from "./PdfPage";
import type { RequestPageRender } from "./PdfPage";
import { isRenderingCancelled } from "./PdfPageRenderer";
import type { PdfPageRenderer } from "./PdfPageRenderer";
import { scrollTargetPage } from "./scrollTargetPage";

/** What the format's driver asks of the viewport. */
export interface PdfViewportControls {
  /** Scrolls the page to the top of the view; false for an unknown page. */
  scrollToPage(pageIndex: number, behavior: ScrollBehavior): boolean;
  /** First and last page in view; null before the pages are laid out. */
  getVisiblePageRange(): [number, number] | null;
}

export interface PdfViewportProps {
  /** Filled with the viewport's controls while it is mounted. */
  controlsRef: MutableRefObject<PdfViewportControls | null>;
  onVisiblePagesChange?: (range: [number, number]) => void;
  /** Passed to every page. Default true. */
  enableNativeLinks?: boolean;
}

// Shared render coordination state
interface PageRenderRequest {
  pageNumber: number;
  zoomLevel: number;
  renderer: PdfPageRenderer | null;
  canvas: HTMLCanvasElement | null;
  onComplete?: (zoomLevel: number) => void;
}

/** Pages in view, and pages mounted (in view, overscan and kept mounted). */
type PageWindow = { visible: [number, number]; mounted: [number, number] };

function sameRange(a: [number, number], b: [number, number]): boolean {
  return a[0] === b[0] && a[1] === b[1];
}

/**
 * The page window for a scroll position. `cumulative[i]` is the top of page
 * `i`'s slot (length = page count + 1); `keepMounted` stretches the mounted
 * range to include those pages.
 */
function computePageWindow(
  cumulative: number[],
  scroll: number,
  viewH: number,
  keepMounted: readonly number[]
): PageWindow {
  const pageCount = cumulative.length - 1;

  // binary search for first page whose bottom >= scrollTop
  let lo = 0,
    hi = cumulative.length - 1;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (cumulative[mid + 1] < scroll) lo = mid + 1;
    else hi = mid;
  }
  const first = Math.min(lo, pageCount - 1);

  // find last page whose top <= scrollTop + viewH
  lo = first;
  hi = cumulative.length - 2;
  const limit = scroll + viewH;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (cumulative[mid] <= limit) lo = mid;
    else hi = mid - 1;
  }
  const last = lo;

  let start = Math.max(0, first - PAGE_OVERSCAN);
  let end = Math.min(pageCount - 1, last + PAGE_OVERSCAN);

  /* ensure the pages that must stay mounted are */
  for (const pageIdx of keepMounted) {
    if (pageIdx < 0 || pageIdx >= pageCount) continue;
    start = Math.min(start, pageIdx);
    end = Math.max(end, pageIdx);
  }

  return { visible: [first, last], mounted: [start, end] };
}

/**
 * Pages that stay mounted whatever the scroll position: those of every
 * selected annotation, of the active highlight, of the pending scroll
 * request's target and of the pending selection. Ascending, no duplicates.
 */
function useKeepMountedPages(): number[] {
  const selectedIds = useSelectedAnnotationIds();
  const annotations = useVisibleAnnotations();
  const highlights = useHighlights();
  const activeHighlightId = useActiveHighlightId();
  const { request } = useScrollRequest();
  const pending = usePendingSelection();
  const target = request?.target ?? null;

  return useMemo(() => {
    const pages = new Set<number>();
    const addAnnotation = (id: string) => {
      const annotation = annotations.find((a) => a.id === id);
      if (annotation) annotationPages(annotation).forEach((p) => pages.add(p));
    };
    const addHighlight = (id: string) => {
      const highlight = highlights.find((h) => h.id === id);
      if (highlight) highlightPages(highlight).forEach((p) => pages.add(p));
    };

    selectedIds.forEach(addAnnotation);
    if (activeHighlightId !== null) addHighlight(activeHighlightId);
    if (target?.kind === "annotation") addAnnotation(target.id);
    if (target?.kind === "highlight") addHighlight(target.id);
    if (pending) draftPages(pending.json).forEach((p) => pages.add(p));
    return [...pages].sort((a, b) => a - b);
  }, [
    selectedIds,
    annotations,
    highlights,
    activeHighlightId,
    target,
    pending,
  ]);
}

export function PdfViewport({
  controlsRef,
  onVisiblePagesChange,
  enableNativeLinks = true,
}: PdfViewportProps) {
  const pageInfos = usePdfPages();
  const zoomLevel = useZoom();
  const root = useRootElement();
  const keepMounted = useKeepMountedPages();
  const allAnnotations = useAllAnnotations();
  const highlights = useHighlights();
  const { request } = useScrollRequest();

  // Shared debounce state for coordinated rendering
  const renderQueueRef = useRef<Map<number, PageRenderRequest>>(new Map());
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastProcessedZoomRef = useRef<number>(zoomLevel);

  // Store pageInfos in a ref to avoid recreating requestPageRender callback
  const pageInfosRef = useRef(pageInfos);
  useEffect(() => {
    pageInfosRef.current = pageInfos;
  }, [pageInfos]);

  /* page-height cache for the current zoom (slot = page + gap) */
  const pageHeights = useMemo(
    () =>
      pageInfos.map((info) =>
        // Round page heights to avoid floating-point precision issues
        Math.round(
          info.page.getViewport({ scale: zoomLevel }).height + PAGE_GAP_PX
        )
      ),
    [pageInfos, zoomLevel]
  );

  /* prefix sums for quick offset lookup */
  const cumulative = useMemo(() => {
    const out: number[] = [0];
    let runningSum = 0;

    for (let i = 0; i < pageHeights.length; i++) {
      // Round each page height to avoid accumulating floating-point errors
      const roundedHeight = Math.round(pageHeights[i]);
      runningSum += roundedHeight;
      out.push(runningSum);
    }
    return out; // length = pageCount + 1
  }, [pageHeights]);

  /* ------------------------------------------------------------------ */
  /* utility: pick the element that actually scrolls ------------------- */
  const getScrollElement = useCallback((): HTMLElement | Window => {
    if (root && root.scrollHeight > root.clientHeight) return root;
    // fallback – the page itself scrolls
    return window;
  }, [root]);

  /** The page window at the current scroll position; null without pages. */
  const measureWindow = useCallback((): PageWindow | null => {
    if (pageHeights.length === 0) return null;
    const el = getScrollElement();
    const scroll =
      el instanceof Window
        ? window.scrollY || window.document.documentElement.scrollTop
        : el.scrollTop;
    const viewH = el instanceof Window ? window.innerHeight : el.clientHeight;
    return computePageWindow(cumulative, scroll, viewH, keepMounted);
  }, [pageHeights.length, getScrollElement, cumulative, keepMounted]);

  /* ---------- visible window tracking -------------------------------- */
  const [pageWindow, setPageWindow] = useState<PageWindow | null>(null);

  const calcRange = useCallback(() => {
    const next = measureWindow();
    setPageWindow((prev) =>
      prev === next ||
      (prev !== null &&
        next !== null &&
        sameRange(prev.visible, next.visible) &&
        sameRange(prev.mounted, next.mounted))
        ? prev
        : next
    );
  }, [measureWindow]);

  /* attach / detach scroll listener(s) */
  useEffect(() => {
    let frame = 0;
    calcRange(); // initial
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(calcRange);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    root?.addEventListener("scroll", onScroll, { passive: true });

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
      root?.removeEventListener("scroll", onScroll);
    };
  }, [root, calcRange]);

  /* report the pages in view when they change */
  const onVisiblePagesChangeRef = useRef(onVisiblePagesChange);
  useLayoutEffect(() => {
    onVisiblePagesChangeRef.current = onVisiblePagesChange;
  });
  const reportedRef = useRef<[number, number] | null>(null);
  const visible = pageWindow?.visible ?? null;
  useEffect(() => {
    if (!visible) {
      reportedRef.current = null; // the next document reports afresh
      return;
    }
    const reported = reportedRef.current;
    if (reported && sameRange(reported, visible)) return;
    reportedRef.current = visible;
    onVisiblePagesChangeRef.current?.([visible[0], visible[1]]);
  }, [visible]);

  /** Scrolls the page to the top of the view; false for an unknown page. */
  const scrollToPage = (pageIndex: number, behavior: ScrollBehavior) => {
    if (
      !Number.isInteger(pageIndex) ||
      pageIndex < 0 ||
      pageIndex >= pageHeights.length
    ) {
      return false;
    }
    const top = Math.max(0, cumulative[pageIndex] - PAGE_GAP_PX);
    getScrollElement().scrollTo({ top, behavior });
    return true;
  };

  /* a scroll request: scroll to the page its target is drawn on first */
  useLayoutEffect(() => {
    if (!request) return;
    const firstPage = scrollTargetPage(
      request.target,
      allAnnotations,
      highlights,
      pageInfos
    );
    // The page scrolls to the box next; its scroll replaces this one, and
    // the request keeps the page mounted until then.
    if (firstPage !== null) scrollToPage(firstPage, request.behavior);
    // Keyed on the request only: one jump per request.
  }, [request]);

  useLayoutEffect(() => {
    controlsRef.current = {
      scrollToPage,
      getVisiblePageRange() {
        const measured = measureWindow();
        return measured ? [measured.visible[0], measured.visible[1]] : null;
      },
    };
  });
  useEffect(
    () => () => {
      controlsRef.current = null;
    },
    [controlsRef]
  );

  /**
   * Coordinated render callback - collects render requests from all pages
   * and processes them together after debouncing
   */
  const requestPageRender = useCallback<RequestPageRender>(
    (pageNumber, renderer, canvas, onComplete) => {
      // Skip if we already have this page in queue - just update zoom level if needed
      if (renderQueueRef.current.has(pageNumber)) {
        const existingRequest = renderQueueRef.current.get(pageNumber);
        if (existingRequest && existingRequest.zoomLevel !== zoomLevel) {
          // Update to latest zoom level and callback
          existingRequest.zoomLevel = zoomLevel;
          existingRequest.onComplete = onComplete;
        }
        // Reset debounce timer to wait for more changes
        if (debounceTimerRef.current) {
          clearTimeout(debounceTimerRef.current);
        }
      } else {
        // New request - add to queue
        renderQueueRef.current.set(pageNumber, {
          pageNumber,
          zoomLevel,
          renderer,
          canvas,
          onComplete,
        });
      }

      // Clear existing timer
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }

      // Set new debounced execution
      debounceTimerRef.current = setTimeout(() => {
        // Process all queued renders at once
        const renderRequests = Array.from(renderQueueRef.current.values());

        // Only render if zoom actually changed
        if (lastProcessedZoomRef.current === zoomLevel) {
          renderQueueRef.current.clear();
          return;
        }

        // Cancel all in-progress renders first
        renderRequests.forEach((request) => {
          if (request.renderer) {
            request.renderer.cancelCurrentRender();
          }
        });

        // Then start new renders
        renderRequests.forEach(async (request) => {
          if (!request.renderer || !request.canvas) return;

          try {
            const viewport = pageInfosRef.current[
              request.pageNumber - 1
            ]?.page.getViewport({ scale: zoomLevel });
            if (viewport) {
              request.canvas.width = viewport.width;
              request.canvas.height = viewport.height;
              await request.renderer.rescaleAndRender(zoomLevel);
              // Call the completion callback if provided
              if (request.onComplete) {
                request.onComplete(zoomLevel);
              }
            }
          } catch (err) {
            // Ignore cancellation errors
            if (!isRenderingCancelled(err)) {
              console.error(`Page ${request.pageNumber} render error:`, err);
            }
          }
        });

        lastProcessedZoomRef.current = zoomLevel;
        renderQueueRef.current.clear();
      }, PAGE_RENDER_DEBOUNCE_MS); // Single shared debounce delay
    },
    [zoomLevel] // pageInfos are read through pageInfosRef
  );

  // Cleanup debounce timer on unmount
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, []);

  /* ---------- render -------------------------------------------------- */
  if (pageInfos.length === 0) return null;

  return (
    <div data-rca-pdf-pages="" style={{ position: "relative" }}>
      {pageInfos.map((pInfo, idx) => {
        const top = cumulative[idx];
        const height = pageHeights[idx];
        const mounted =
          pageWindow !== null &&
          idx >= pageWindow.mounted[0] &&
          idx <= pageWindow.mounted[1];

        return (
          <div
            key={pInfo.page.pageNumber}
            style={{
              position: "absolute",
              top,
              height,
              width: "100%",
            }}
          >
            {mounted && (
              <PdfPage
                pageInfo={pInfo}
                onZoomRenderRequest={requestPageRender}
                enableNativeLinks={enableNativeLinks}
              />
            )}
          </div>
        );
      })}
      {/* spacer so the scroll container has correct total height */}
      <div style={{ height: cumulative[cumulative.length - 1] }} />
    </div>
  );
}
