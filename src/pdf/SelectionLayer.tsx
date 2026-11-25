/**
 * Drag-to-select text on one PDF page. Ported from OpenContracts'
 * `SelectionLayer` (`renderers/pdf/SelectionLayer.tsx`, 98286cabf): the
 * mouse and touch handlers, the document-level mousemove / mouseup fallback
 * (so a release over anything, anywhere, still finishes the gesture), the
 * double-fire guard on release, long-press selection on touch, Shift to add
 * a region, and Escape to cancel.
 *
 * The layer is the page's canvas wrapper: the canvas and every layer drawn
 * over it (native links, highlights, annotation boxes) are its children, so
 * a press anywhere on the page that nothing stopped reaches it by bubbling.
 * Annotation and highlight boxes let a plain press through (modifier presses,
 * link annotations and the host's chip content stop theirs), which is what
 * lets text under an annotation, a structural one covering a whole paragraph
 * included, be drag-selected while the boxes keep their hover and clicks. In
 * OpenContracts the layer was a sibling overlay beneath the boxes and
 * nothing passed their presses on to it.
 *
 * The gesture: a press arms it (and the document listeners); nothing changes
 * until the pointer has moved more than `CLICK_DRAG_TOLERANCE_PX`. Then it is
 * a drag (on touch, a long press is), which clears the pending selection and
 * the annotation selection (with `{ source: "user" }`, and only when there is
 * one) and selects text. A release with Shift keeps the region; a release
 * without builds the draft from every kept region and this one, on whichever
 * pages they are, and completes it through core (`useCompleteSelection`),
 * which applies the outcomes. A draft with no token completes nothing.
 *
 * A press released before it is a drag is a click, and selects no text. A
 * click on the blank page (pressed and released on the page itself: this
 * layer or its canvas, not on a box, a label chip or host content in it, or
 * a link) clears the annotation selection and the pending selection, as
 * above, unless Shift, Ctrl or Cmd is held (a toggle that missed its box); a
 * click on an annotation or highlight box clears nothing and is left to the
 * box. A tap on the blank page is such a click. On a page without
 * tokens (no PAWLs, where bounds-only annotations still render) a press is
 * recorded so its click is seen, but it never becomes a drag: a drag there
 * selects and clears nothing.
 *
 * Painted here: the drag in progress and the kept regions on this page, with
 * the tokens they capture (`[data-rca-drag-region]`, `[data-rca-drag-token]`),
 * and the store's pending selection on this page (`[data-rca-pending-region]`
 * and `[data-rca-pending-token]`), each `[data-rca-page-part="<page>"]`. They
 * take no pointer events, and are drawn before the page's other layers, so
 * at the same stacking (`--rca-z-pending`, default 2, as the annotation
 * boxes) the boxes stay on top.
 *
 * Touch: while a long press selects, a move extends the selection and does
 * not scroll: the root stops scrolling, and the layer's own non-passive
 * `touchmove` listener (React's is passive, so it cannot) prevents the
 * page's. A cancelled touch (`touchcancel`) ends the long press without a
 * selection and gives the root its scrolling back.
 *
 * Removed from OpenContracts: the action menu and its portal, its keyboard
 * shortcuts and cooldown, "copy link", the URL modal, corpus and permission
 * checks (`readOnly` is applied by core when committing) and the
 * `isCreatingAnnotation` flag. Presses on a link (the PDF's own links) are
 * left to the link, as when they sat above OpenContracts' layer.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  MouseEvent as ReactMouseEvent,
  ReactNode,
  TouchEvent as ReactTouchEvent,
} from "react";
import styled from "styled-components";

import {
  draftPages,
  ESCAPE_KEY,
  useCompleteSelection,
  useEditing,
  usePendingActions,
  usePendingSelection,
  useRootElement,
  useSelectedAnnotationIds,
  useSetControllable,
} from "../core/index";
import type {
  AnnotationDraft,
  BoundingBox,
  ChangeInfo,
  MultipageAnnotationJson,
  TokenId,
} from "../core/index";
import {
  CLICK_DRAG_TOLERANCE_PX,
  LONG_PRESS_MS,
  LONG_PRESS_VIBRATION_MS,
  SELECTION_COLOR,
  TOUCH_MOVE_THRESHOLD_PX,
} from "./constants";
import { NO_DRAG, usePdfDrag, usePdfDragControls } from "./dragState";
import { usePdfPages } from "./loader";
import type { PDFPageInfo } from "./PDFPageInfo";
import { SelectionBoundary } from "./SelectionBoundary";
import { TokenGroup } from "./TokenGroup";

const USER: ChangeInfo = Object.freeze({ source: "user" });

/** The stacking of a selection being made or pending (defined on the root). */
const PENDING_Z_INDEX_VALUE = "var(--rca-z-pending)";

/**
 * This wrapper is inline-block (shrink-wrapped) and position:relative
 * so that absolutely-positioned elements inside it match the canvas.
 */
const CanvasWrapper = styled.div`
  position: relative;
  display: inline-block;
`;

type Point = { x: number; y: number };

/**
 * Where a press happened: in the viewport, and on the page (scale 1);
 * whether it landed on the blank page; and whether the pointer has since
 * moved further than a click may.
 */
type Press = { client: Point; page: Point; blank: boolean; moved: boolean };

/** Where a touch began, and whether on the blank page. */
type TouchStart = Point & { blank: boolean };

/** What finishing a gesture needs of the event that released it. */
type Release = Pick<
  MouseEvent,
  "clientX" | "clientY" | "shiftKey" | "ctrlKey" | "metaKey" | "target"
>;

/** Whether a release held Shift, Ctrl or Cmd. */
function isModified({ shiftKey, ctrlKey, metaKey }: Release): boolean {
  return shiftKey || ctrlKey || metaKey;
}

/**
 * The draft of the regions: for each page with at least one token captured,
 * its JSON (`pages` at scale 1, the regions' coordinates); `page` is the
 * lowest such page and `rawText` the pages' texts in page order. Null when no
 * token is captured.
 */
function buildDraft(
  regions: Record<number, BoundingBox[]>,
  pages: readonly PDFPageInfo[]
): AnnotationDraft | null {
  const json: MultipageAnnotationJson = {};
  const texts: string[] = [];
  const pageIndices = Object.keys(regions)
    .map(Number)
    .sort((a, b) => a - b);
  for (const pageIndex of pageIndices) {
    const page = pages[pageIndex];
    if (!page) continue;
    const pageJson = page.getPageAnnotationJson(regions[pageIndex]);
    if (pageJson.tokensJsons.length === 0) continue;
    json[pageIndex] = pageJson;
    texts.push(pageJson.rawText);
  }
  const captured = Object.keys(json).map(Number);
  if (captured.length === 0) return null;
  return {
    json,
    rawText: texts.join(" "),
    page: Math.min(...captured),
    annotationLabel: null,
  };
}

/** Whether the press landed on a link, which takes its own presses. */
function isOnLink(target: EventTarget): boolean {
  return target instanceof Element && target.closest("a[href]") !== null;
}

export interface SelectionLayerProps {
  /** The page at the current zoom. */
  pageInfo: PDFPageInfo;
  /** The page's canvas and the layers drawn over it. */
  children?: ReactNode;
}

export function SelectionLayer({ pageInfo, children }: SelectionLayerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const pages = usePdfPages();
  const drag = usePdfDrag();
  const controls = usePdfDragControls();
  const pending = usePendingSelection();
  const pendingActions = usePendingActions();
  const completeSelection = useCompleteSelection();
  const selectedIds = useSelectedAnnotationIds();
  const setSelection = useSetControllable<string[]>("selection");
  const { activeLabel } = useEditing();
  const root = useRootElement();
  const pageIndex = pageInfo.page.pageNumber - 1;
  const scale = pageInfo.scale;
  const selectable = pageInfo.tokens.length > 0;

  /**
   * The press of the gesture in progress on this page, or null. A ref, so
   * the second of the two handlers that hear one release (the layer's
   * `onMouseUp` and the document's listener) finds it already cleared: the
   * double-fire guard of OpenContracts' `finalizingRef`.
   */
  const pressRef = useRef<Press | null>(null);
  /** Whether a mouse press is in progress: the document listeners are on. */
  const [armed, setArmed] = useState(false);

  // Long press detection for touch
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );
  const touchStartRef = useRef<TouchStart | null>(null);
  const [isLongPressActive, setIsLongPressActive] = useState(false);
  /** `isLongPressActive` for the native `touchmove` listener. */
  const longPressRef = useRef(false);
  const setLongPress = useCallback((active: boolean) => {
    longPressRef.current = active;
    setIsLongPressActive(active);
  }, []);

  /** A viewport point on this page, unscaled. Null once unmounted. */
  const toPage = useCallback(
    (clientX: number, clientY: number): Point | null => {
      const container = containerRef.current;
      if (!container) return null;
      const rect = container.getBoundingClientRect();
      return {
        x: (clientX - rect.left) / scale,
        y: (clientY - rect.top) / scale,
      };
    },
    [scale]
  );

  const clearLongPressTimer = useCallback(() => {
    if (longPressTimerRef.current !== null) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }, []);

  /**
   * Whether `target` is the page itself: this layer or its canvas, not
   * anything drawn over them (boxes, their chips and host content, links).
   */
  const isBlank = useCallback((target: EventTarget | null): boolean => {
    const container = containerRef.current;
    return (
      container !== null &&
      (target === container ||
        (target instanceof HTMLCanvasElement &&
          target.parentElement === container))
    );
  }, []);

  /**
   * A new selection begins, or the blank page was clicked: the pending
   * selection ends and the annotation selection, if any, is cleared.
   */
  const clearSelections = useCallback(() => {
    pendingActions.clear();
    if (selectedIds.length > 0) setSelection([], USER);
  }, [pendingActions, selectedIds, setSelection]);

  /** Ends the press without a selection. */
  const disarm = useCallback(() => {
    pressRef.current = null;
    setArmed(false);
  }, []);

  /** The press becomes a drag from `origin` to `to`: a new selection begins. */
  const begin = useCallback(
    (origin: Point, to: Point) => {
      clearSelections();
      controls.set({
        ...controls.get(),
        active: {
          pageIndex,
          bounds: { left: origin.x, top: origin.y, right: to.x, bottom: to.y },
        },
      });
    },
    [clearSelections, controls, pageIndex]
  );

  /**
   * The pointer is at a viewport point: start or extend the drag. On a page
   * without tokens the press only records that it moved.
   */
  const moveTo = useCallback(
    (clientX: number, clientY: number) => {
      const press = pressRef.current;
      if (!press) return;
      const point = toPage(clientX, clientY);
      if (!point) return;
      const current = controls.get();
      const { active } = current;
      if (active === null) {
        if (press.moved) return;
        const moved = Math.hypot(
          clientX - press.client.x,
          clientY - press.client.y
        );
        if (moved <= CLICK_DRAG_TOLERANCE_PX) return;
        press.moved = true;
        if (selectable) begin(press.page, point);
        return;
      }
      if (active.pageIndex !== pageIndex) return;
      controls.set({
        ...current,
        active: {
          pageIndex,
          bounds: { ...active.bounds, right: point.x, bottom: point.y },
        },
      });
    },
    [toPage, controls, selectable, begin, pageIndex]
  );

  /**
   * Finalises the gesture at the release's viewport point, whichever handler
   * heard it: with Shift the region is kept, otherwise the draft of every
   * kept region completes. A press that never became a drag selects no
   * text; pressed and released on the blank page without a modifier, it
   * clears the selections.
   */
  const finish = useCallback(
    (release: Release) => {
      const { clientX, clientY, shiftKey, target } = release;
      const press = pressRef.current;
      if (!press) return;
      disarm();
      const current = controls.get();
      const { active } = current;
      if (!active) {
        const blankClick = !press.moved && press.blank && isBlank(target);
        if (blankClick && !isModified(release)) clearSelections();
        return;
      }
      if (active.pageIndex !== pageIndex) return;

      const point = toPage(clientX, clientY);
      const bounds = point
        ? { ...active.bounds, right: point.x, bottom: point.y }
        : active.bounds;
      const regions = {
        ...current.regions,
        [pageIndex]: [...(current.regions[pageIndex] ?? []), bounds],
      };
      if (shiftKey) {
        controls.set({ active: null, regions });
        return;
      }
      controls.set(NO_DRAG);
      const draft = buildDraft(regions, pages);
      if (draft) completeSelection(draft, { x: clientX, y: clientY });
    },
    [
      disarm,
      controls,
      isBlank,
      clearSelections,
      pageIndex,
      toPage,
      pages,
      completeSelection,
    ]
  );

  /** Escape: the gesture and the regions kept with Shift are dropped. */
  const cancel = useCallback(() => {
    disarm();
    clearLongPressTimer();
    setLongPress(false);
    controls.set(NO_DRAG);
  }, [disarm, clearLongPressTimer, setLongPress, controls]);

  /**
   * Handles the mouse down event to start the selection.
   */
  const handleMouseDown = (event: ReactMouseEvent<HTMLDivElement>) => {
    // Allow selection for copying even in read-only mode
    if (pressRef.current || event.buttons !== 1) return;
    if (isOnLink(event.target)) return;
    const page = toPage(event.clientX, event.clientY);
    if (!page) return;
    pressRef.current = {
      client: { x: event.clientX, y: event.clientY },
      page,
      blank: isBlank(event.target),
      moved: false,
    };
    setArmed(true);
  };

  /**
   * Handles the mouse up event to finalize the selection.
   */
  const handleMouseUp = (event: ReactMouseEvent<HTMLDivElement>) => {
    finish(event);
  };

  /**
   * Handles touch start for mobile long press detection (on a page with
   * tokens) and for taps
   */
  const handleTouchStart = (event: ReactTouchEvent<HTMLDivElement>) => {
    if (pressRef.current || event.touches.length !== 1) return;
    const touch = event.touches[0];
    const start = {
      x: touch.clientX,
      y: touch.clientY,
      blank: isBlank(event.target),
    };
    touchStartRef.current = start;
    clearLongPressTimer();
    if (!selectable) return;
    longPressTimerRef.current = setTimeout(() => {
      longPressTimerRef.current = null;
      const page = toPage(start.x, start.y);
      if (!page) return;
      // Vibrate if supported (haptic feedback)
      navigator.vibrate?.(LONG_PRESS_VIBRATION_MS);
      pressRef.current = {
        client: { x: start.x, y: start.y },
        page,
        blank: start.blank,
        moved: false,
      };
      setLongPress(true);
      begin(page, page);
    }, LONG_PRESS_MS);
  };

  /**
   * Handles touch move - cancels long press if moved too much, or updates selection if active
   */
  const handleTouchMove = (event: ReactTouchEvent<HTMLDivElement>) => {
    if (event.touches.length !== 1) return;
    const touch = event.touches[0];

    // If long press hasn't activated yet, check for movement threshold
    const start = touchStartRef.current;
    if (start && !isLongPressActive) {
      const distance = Math.hypot(
        touch.clientX - start.x,
        touch.clientY - start.y
      );
      if (distance > TOUCH_MOVE_THRESHOLD_PX) {
        // Cancel long press (and the tap) if moved too much
        clearLongPressTimer();
        touchStartRef.current = null;
      }
    }

    // If long press is active, the move extends the selection (and the
    // layer's native listener keeps it from scrolling the page)
    if (isLongPressActive) {
      event.stopPropagation();
      moveTo(touch.clientX, touch.clientY);
    }
  };

  /**
   * Handles touch end - finalize selection if active; a tap (released before
   * a long press began, without moving away) on the blank page is a blank
   * click
   */
  const handleTouchEnd = (event: ReactTouchEvent<HTMLDivElement>) => {
    const tapStart = touchStartRef.current;
    clearLongPressTimer();
    touchStartRef.current = null;
    if (!isLongPressActive) {
      if (tapStart?.blank) clearSelections();
      return;
    }
    setLongPress(false);
    const touch = event.changedTouches[0];
    if (touch) {
      finish({
        clientX: touch.clientX,
        clientY: touch.clientY,
        shiftKey: false,
        ctrlKey: false,
        metaKey: false,
        target: null,
      });
    } else {
      disarm();
    }
  };

  /**
   * Handles touch cancel (the browser took the touch over): the long press,
   * or the hold that would have started one, ends without a selection; the
   * regions kept with Shift stay
   */
  const handleTouchCancel = () => {
    clearLongPressTimer();
    touchStartRef.current = null;
    if (!isLongPressActive) return;
    setLongPress(false);
    disarm();
    const current = controls.get();
    if (current.active?.pageIndex === pageIndex) {
      controls.set({ ...current, active: null });
    }
  };

  // Document-level mouseup / mousemove (and Escape) while a press is in
  // progress, so gestures that release (or drift) over anything else, inside
  // the annotator or out of it, still complete cleanly.
  useEffect(() => {
    if (!armed) return;

    const handleDocMouseUp = (event: MouseEvent) => {
      finish(event);
    };
    const handleDocMouseMove = (event: MouseEvent) => {
      moveTo(event.clientX, event.clientY);
    };
    const handleDocKeyDown = (event: KeyboardEvent) => {
      if (event.key === ESCAPE_KEY) cancel();
    };

    document.addEventListener("mouseup", handleDocMouseUp);
    document.addEventListener("mousemove", handleDocMouseMove);
    document.addEventListener("keydown", handleDocKeyDown);
    return () => {
      document.removeEventListener("mouseup", handleDocMouseUp);
      document.removeEventListener("mousemove", handleDocMouseMove);
      document.removeEventListener("keydown", handleDocKeyDown);
    };
  }, [armed, finish, moveTo, cancel]);

  // Cleanup long press timer on unmount
  useEffect(() => clearLongPressTimer, [clearLongPressTimer]);

  // React listens to touchmove passively, so its handler cannot keep a
  // selecting move from scrolling the page. This listener can: it is not
  // passive, and it is there from the touch's start (a browser decides then
  // whether a touch's moves can be cancelled).
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const preventScroll = (event: TouchEvent) => {
      if (longPressRef.current && event.cancelable) event.preventDefault();
    };
    container.addEventListener("touchmove", preventScroll, { passive: false });
    return () => container.removeEventListener("touchmove", preventScroll);
  }, []);

  // Disable scrolling on the scroll container while a long press selects
  useEffect(() => {
    if (!root || !isLongPressActive) return;
    // Store original values
    const originalOverflow = root.style.overflow;
    const originalTouchAction = root.style.touchAction;

    // Disable scrolling
    root.style.overflow = "hidden";
    root.style.touchAction = "none";

    return () => {
      // Restore original values
      root.style.overflow = originalOverflow;
      root.style.touchAction = originalTouchAction;
    };
  }, [root, isLongPressActive]);

  const basePage = pages[pageIndex];
  const dragColor = activeLabel?.color || SELECTION_COLOR;
  const dragRegions = [
    ...(drag.regions[pageIndex] ?? []),
    ...(drag.active?.pageIndex === pageIndex ? [drag.active.bounds] : []),
  ];
  const pendingPage =
    pending && draftPages(pending.json).includes(pageIndex)
      ? (pending.json as MultipageAnnotationJson)[pageIndex]
      : undefined;
  const pagePart = String(pageIndex);

  return (
    <CanvasWrapper
      ref={containerRef}
      data-rca-selection-layer=""
      onMouseDown={handleMouseDown}
      onMouseUp={handleMouseUp}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handleTouchCancel}
      style={{ touchAction: isLongPressActive ? "none" : "auto" }}
    >
      {dragRegions.map((bounds, index) => (
        <DrawnRegion
          key={`drag-${index}`}
          pageInfo={pageInfo}
          bounds={bounds}
          color={dragColor}
          tokens={
            basePage?.getPageAnnotationJson([bounds]).tokensJsons ?? null
          }
          boxAttribute="data-rca-drag-region"
          tokenAttribute="data-rca-drag-token"
          pagePart={pagePart}
        />
      ))}
      {pendingPage && (
        <DrawnRegion
          pageInfo={pageInfo}
          bounds={pendingPage.bounds}
          color={SELECTION_COLOR}
          tokens={pendingPage.tokensJsons}
          boxAttribute="data-rca-pending-region"
          tokenAttribute="data-rca-pending-token"
          pagePart={pagePart}
        />
      )}
      {children}
    </CanvasWrapper>
  );
}

interface DrawnRegionProps {
  /** The page at the current zoom. */
  pageInfo: PDFPageInfo;
  /** Unscaled. */
  bounds: BoundingBox;
  color: string;
  tokens: TokenId[] | null;
  boxAttribute: "data-rca-drag-region" | "data-rca-pending-region";
  tokenAttribute: "data-rca-drag-token" | "data-rca-pending-token";
  pagePart: string;
}

/** A selection region's box and the tokens it holds, at the page's zoom. */
function DrawnRegion({
  pageInfo,
  bounds,
  color,
  tokens,
  boxAttribute,
  tokenAttribute,
  pagePart,
}: DrawnRegionProps) {
  return (
    <>
      <SelectionBoundary
        showBoundingBox
        color={color}
        bounds={pageInfo.getScaledBounds(bounds)}
        selected={false}
        passive
        zIndex={PENDING_Z_INDEX_VALUE}
        dataAttributes={{ [boxAttribute]: "", "data-rca-page-part": pagePart }}
      />
      <TokenGroup
        ownerId=""
        attribute={tokenAttribute}
        color={color}
        pageInfo={pageInfo}
        tokens={tokens}
      />
    </>
  );
}
