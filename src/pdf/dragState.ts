/**
 * The PDF text-selection gesture's state, shared by every page of one
 * annotator: the drag in progress and the regions kept with Shift, both in
 * page coordinates (scale 1, like annotation bounds), so a zoom between two
 * Shift-drags does not move them.
 *
 * It is viewer-level rather than a page's own state (OpenContracts kept it in
 * each page's `SelectionLayer`), so Shift-drags on different pages add up to
 * one multipage draft and outlive a page leaving the virtual window. It is
 * React state of the PDF format, provided through contexts private to
 * `src/pdf`, the way the pages are (`PdfPagesContext`); once a selection
 * completes it is the store's pending selection, not this.
 *
 * `PdfDragProvider` also lets Escape cancel the gesture while it holds
 * anything, and drops it when a different document loads. It survives the
 * pages being rebuilt for the same document (new PAWLs, or an equal `pawls`
 * passed anew): kept regions are page rectangles, evaluated against the
 * tokens there are when the selection completes.
 */
import {
  createContext,
  createElement,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";

import type { BoundingBox } from "../core/index";
import { ESCAPE_KEY } from "./constants";
import type { PDFPageInfo } from "./PDFPageInfo";

export interface PdfDragState {
  /** The drag in progress, on the page it started on; null between drags. */
  active: { pageIndex: number; bounds: BoundingBox } | null;
  /** Regions released with Shift, by page index, not yet a pending selection. */
  regions: Record<number, BoundingBox[]>;
}

/** No drag in progress and no regions kept. */
export const NO_DRAG: PdfDragState = Object.freeze({
  active: null,
  regions: Object.freeze({}) as Record<number, BoundingBox[]>,
});

/** Reads and writes the gesture state. Stable for the life of the provider. */
export interface PdfDragControls {
  /** The state as last written, which a render may not have shown yet. */
  get(): PdfDragState;
  set(next: PdfDragState): void;
}

const NO_PAGES: readonly number[] = Object.freeze([]);

const PdfDragStateContext = createContext<PdfDragState>(NO_DRAG);
const PdfDragControlsContext = createContext<PdfDragControls | null>(null);
const PdfDragPagesContext = createContext<readonly number[]>(NO_PAGES);

/** The pages the state touches, ascending. */
function touchedPages({ active, regions }: PdfDragState): number[] {
  const pages = new Set(Object.keys(regions).map(Number));
  if (active) pages.add(active.pageIndex);
  return [...pages].sort((a, b) => a - b);
}

export interface PdfDragProviderProps {
  /** The document's pages; a different document drops the gesture. */
  pages: readonly PDFPageInfo[];
  children?: ReactNode;
}

/**
 * What identifies the document of `pages`: its first page's pdf.js proxy.
 * The loader rebuilds the page infos of one document around the same proxies
 * (a document hands out one proxy per page), and every load makes new ones.
 * Null while there are no pages.
 */
function documentOf(pages: readonly PDFPageInfo[]): object | null {
  return pages[0]?.page ?? null;
}

export function PdfDragProvider({ pages, children }: PdfDragProviderProps) {
  const [state, setState] = useState<PdfDragState>(NO_DRAG);
  const latest = useRef(state);
  const controls = useMemo<PdfDragControls>(
    () => ({
      get: () => latest.current,
      set(next) {
        latest.current = next;
        setState(next);
      },
    }),
    []
  );

  // Regions of another document must not end up in a draft of this one.
  const documentKey = documentOf(pages);
  useLayoutEffect(() => {
    if (latest.current !== NO_DRAG) controls.set(NO_DRAG);
  }, [documentKey, controls]);

  const holding = state !== NO_DRAG;
  useEffect(() => {
    if (!holding) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === ESCAPE_KEY) controls.set(NO_DRAG);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [holding, controls]);

  // A new array only when the set of pages changes, not on every move.
  const pagesKey = touchedPages(state).join(",");
  const touched = useMemo(
    () => (pagesKey === "" ? NO_PAGES : pagesKey.split(",").map(Number)),
    [pagesKey]
  );

  return createElement(
    PdfDragControlsContext.Provider,
    { value: controls },
    createElement(
      PdfDragPagesContext.Provider,
      { value: touched },
      createElement(PdfDragStateContext.Provider, { value: state }, children)
    )
  );
}

/** The gesture state, as rendered. Re-renders on every move of a drag. */
export function usePdfDrag(): PdfDragState {
  return useContext(PdfDragStateContext);
}

/** Reads and writes the gesture state; throws outside `PdfDragProvider`. */
export function usePdfDragControls(): PdfDragControls {
  const controls = useContext(PdfDragControlsContext);
  if (!controls) {
    throw new Error("usePdfDragControls must be used inside PdfDragProvider");
  }
  return controls;
}

/**
 * The pages the drag in progress and the kept regions are on, ascending: they
 * stay mounted. Changes only when that set does.
 */
export function usePdfDragPages(): readonly number[] {
  return useContext(PdfDragPagesContext);
}
