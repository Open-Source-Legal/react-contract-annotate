/**
 * Shared setup of the selection-layer suites: pages of three tokens, each
 * page's `SelectionLayer` rendered inside a real `AnnotatorShell` with the
 * PDF format's page and drag contexts around them, and a mouse drag that
 * goes the way a browser delivers one (press on the layer, moves and release
 * on the document unless told otherwise).
 *
 * jsdom lays nothing out, so every layer's box is at the origin: a client
 * point is a page point times the page's scale.
 */
import { fireEvent, render } from "@testing-library/react";
import type { PDFPageProxy } from "pdfjs-dist/types/src/display/api";
import type { ReactNode } from "react";

import { AnnotatorShell } from "../../core/index";
import type { AnnotatorCommonProps, PawlsToken } from "../../core/index";
import { CLICK_DRAG_TOLERANCE_PX } from "../constants";
import { PdfDragProvider } from "../dragState";
import { PdfPagesContext } from "../loader";
import { PDFPageInfo } from "../PDFPageInfo";
import { SelectionLayer } from "../SelectionLayer";
import { fakePage } from "./pdfjsFake";

export const TOKENS: PawlsToken[] = [
  { x: 10, y: 10, width: 20, height: 5, text: "Hello" },
  { x: 35, y: 10, width: 20, height: 5, text: "world" },
  { x: 10, y: 30, width: 20, height: 5, text: "again" },
];

/** A point inside token 0 and one inside token 1, in page coordinates. */
export const IN_HELLO = Object.freeze({ x: 12, y: 11 });
export const IN_WORLD = Object.freeze({ x: 50, y: 14 });
/** A point clear of every token. */
export const BLANK = Object.freeze({ x: 200, y: 200 });

/** The selector of a page's selection layer. */
export const LAYER = "[data-rca-selection-layer]";

/** A page of `TOKENS` (or of `tokens`) at scale 1. */
export function pageInfo(
  pageNumber: number,
  tokens: PawlsToken[] = TOKENS
): PDFPageInfo {
  return new PDFPageInfo(
    fakePage(pageNumber) as unknown as PDFPageProxy,
    tokens,
    1
  );
}

type Common = Partial<AnnotatorCommonProps>;

/**
 * Renders a selection layer per page under one annotator. `zoom` is the
 * scale the layers draw at (the shell's zoom too).
 */
export function renderLayers(
  common: Common = {},
  {
    pages = [pageInfo(1)],
    zoom = 1,
    content = <canvas />,
  }: {
    pages?: PDFPageInfo[];
    zoom?: number;
    /** What each layer wraps; default a canvas. */
    content?: ReactNode;
  } = {}
) {
  const tree = (next: Common, nextPages: PDFPageInfo[]) => (
    <AnnotatorShell
      common={{ annotations: [], zoom, ...next }}
      handleRef={null}
    >
      <PdfPagesContext.Provider value={nextPages}>
        <PdfDragProvider pages={nextPages}>
          {nextPages.map((page) => (
            <SelectionLayer
              key={page.page.pageNumber}
              pageInfo={page.withScale(zoom)}
            >
              {content}
            </SelectionLayer>
          ))}
        </PdfDragProvider>
      </PdfPagesContext.Provider>
    </AnnotatorShell>
  );
  const view = render(tree(common, pages));
  const layer = (pageIndex = 0): HTMLElement => {
    const found =
      view.container.querySelectorAll<HTMLElement>(LAYER)[pageIndex];
    if (!found) throw new Error(`no selection layer for page ${pageIndex}`);
    return found;
  };
  return {
    ...view,
    layer,
    /** Re-renders with new common props and, if given, new pages. */
    rerender: (next: Common, nextPages: PDFPageInfo[] = pages) =>
      view.rerender(tree(next, nextPages)),
  };
}

type Point = { x: number; y: number };

/** A page point as a client point at `zoom`. */
function client(point: Point, zoom: number) {
  return { clientX: point.x * zoom, clientY: point.y * zoom };
}

/**
 * Presses on `layer` at `from`, moves to `to` and releases there (page
 * coordinates at `zoom`). The moves and release go to the document, as when
 * the pointer leaves the page, unless `releaseOnLayer`.
 */
export function drag(
  layer: HTMLElement,
  from: Point,
  to: Point,
  {
    zoom = 1,
    shift = false,
    releaseOnLayer = false,
  }: { zoom?: number; shift?: boolean; releaseOnLayer?: boolean } = {}
): void {
  fireEvent.mouseDown(layer, { ...client(from, zoom), buttons: 1 });
  fireEvent.mouseMove(document, client(to, zoom));
  fireEvent.mouseUp(releaseOnLayer ? layer : document, {
    ...client(to, zoom),
    shiftKey: shift,
  });
}

/** A one-finger touch point at a page point (scale 1). */
export function touchAt(point: Point) {
  return [{ clientX: point.x, clientY: point.y }];
}

/**
 * A click on `target` at a page point (zoom 1): pressed and released on it,
 * moving `moveBy` px in between (default 0; a click may move up to
 * `CLICK_DRAG_TOLERANCE_PX`), then the click event. `releaseOn` releases
 * somewhere else instead (no click event follows).
 */
export function click(
  target: HTMLElement,
  at: Point,
  {
    moveBy = 0,
    releaseOn,
  }: { moveBy?: number; releaseOn?: HTMLElement | Document } = {}
): void {
  if (moveBy > CLICK_DRAG_TOLERANCE_PX) {
    throw new Error("a click moves no further than CLICK_DRAG_TOLERANCE_PX");
  }
  const near = client({ x: at.x + moveBy, y: at.y }, 1);
  fireEvent.mouseDown(target, { ...client(at, 1), buttons: 1 });
  fireEvent.mouseMove(document, near);
  fireEvent.mouseUp(releaseOn ?? target, near);
  if (!releaseOn) fireEvent.click(target, near);
}

/** The canvas a layer wraps: the blank page. */
export function canvasOf(layer: HTMLElement): HTMLElement {
  const canvas = layer.querySelector<HTMLElement>("canvas");
  if (!canvas) throw new Error("the layer wraps no canvas");
  return canvas;
}
