/**
 * The format contract. A renderer (PDF, DOCX, …) is a component rendered
 * inside `AnnotatorShell`; it registers a `FormatDriver` so the shell can
 * answer the format-specific half of the handle, and reports when its
 * fit-to-width zoom may have changed.
 */
import { atom } from "jotai";
import { useCallback, useLayoutEffect, useRef } from "react";

import type { ScrollTarget } from "./scroll";
import { useAnnotatorStore } from "./state/AnnotatorProvider";
import type { Highlight } from "./types";

export interface FormatDriver {
  /** The annotation kind this format draws. */
  kind: "token" | "span";
  /** Null for unpaginated formats. */
  getPageCount(): number | null;
  getVisiblePageRange(): [number, number] | null;
  getText(): string;
  findText(query: string, opts?: { caseSensitive?: boolean }): Highlight[];
  /** True when the format scrolled (or started scrolling) to the page. */
  scrollToPage(pageIndex: number, behavior: ScrollBehavior): boolean;
  /** The zoom that fits the page width; null until it can be measured. */
  resolveFitWidth(): number | null;
  /**
   * True when the id is known and this format can draw it now. Asked by
   * `scrollToAnnotation` / `scrollToHighlight`, and by the shell when it
   * handles a selection or active-highlight change (once the document is
   * ready and the id is in the data). A change it answers false for is not
   * dropped: the shell asks again whenever the selection, the data, the
   * status or the driver changes, and when the format calls the function
   * from `useNotifyDrawabilityChanged()`. A format whose answer can turn
   * true for any other reason (pages laid out, a projection finished) must
   * call it then. It may be asked in the commit that supplies the target,
   * before any render has shown it: read the annotations and highlights
   * with `useReadDocumentData()` when it is called, not from a render.
   */
  canDraw(target: ScrollTarget): boolean;
}

/** The driver of the mounted format, or null before one registers. */
export const formatDriverAtom = atom<FormatDriver | null>(null);

/** Bumped whenever a format reports that `resolveFitWidth()` may differ. */
export const fitWidthVersionAtom = atom(0);

/** Bumped whenever a format reports that `canDraw()` may answer differently. */
export const drawabilityVersionAtom = atom(0);

/**
 * Registers the format's driver for as long as the calling component is
 * mounted. `driver` may be a new object on every render: the shell is given
 * one stable driver, registered once, that forwards each call to the latest
 * object passed here.
 */
export function useRegisterFormatDriver(driver: FormatDriver): void {
  const store = useAnnotatorStore("useRegisterFormatDriver");
  const latest = useRef(driver);

  useLayoutEffect(() => {
    latest.current = driver;
  });

  useLayoutEffect(() => {
    const registered: FormatDriver = {
      get kind() {
        return latest.current.kind;
      },
      getPageCount: () => latest.current.getPageCount(),
      getVisiblePageRange: () => latest.current.getVisiblePageRange(),
      getText: () => latest.current.getText(),
      findText: (query, opts) => latest.current.findText(query, opts),
      scrollToPage: (pageIndex, behavior) =>
        latest.current.scrollToPage(pageIndex, behavior),
      resolveFitWidth: () => latest.current.resolveFitWidth(),
      canDraw: (target) => latest.current.canDraw(target),
    };
    store.set(formatDriverAtom, registered);
    return () => {
      store.set(formatDriverAtom, (current) =>
        current === registered ? null : current
      );
    };
  }, [store]);
}

/**
 * A stable function a format calls when `resolveFitWidth()` may now return
 * something different (its container was measured or resized), so the shell
 * can resolve a pending fit-to-width initial zoom.
 */
export function useNotifyFitWidthChanged(): () => void {
  const store = useAnnotatorStore("useNotifyFitWidthChanged");
  return useCallback(() => {
    store.set(fitWidthVersionAtom, (version) => version + 1);
  }, [store]);
}

/**
 * A stable function a format calls when `canDraw()` may now answer
 * differently, so the shell can raise a scroll request it was holding back
 * for a target that was not drawable yet.
 */
export function useNotifyDrawabilityChanged(): () => void {
  const store = useAnnotatorStore("useNotifyDrawabilityChanged");
  return useCallback(() => {
    store.set(drawabilityVersionAtom, (version) => version + 1);
  }, [store]);
}
