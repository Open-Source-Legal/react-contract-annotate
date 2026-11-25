/**
 * The format-agnostic half of every annotator. `AnnotatorShell` owns the
 * instance store, feeds the common props into it, renders the root element
 * (the scroll container) with the theming custom properties and the
 * loading / error slots, fires `onDocumentLoad` / `onError` from the status
 * the format reports, raises scroll requests for selection and highlight
 * changes, and implements the imperative handle on top of the driver the
 * format registers (see `format.ts`).
 */
import { useAtomValue } from "jotai";
import type { Atom, PrimitiveAtom } from "jotai";
import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
} from "react";
import type { CSSProperties, MutableRefObject, ReactNode, Ref } from "react";

import {
  DEFAULT_SCROLL_BEHAVIOR,
  THEME_DEFAULTS,
  ZOOM_DECIMALS,
  ZOOM_MAX,
  ZOOM_MIN,
  ZOOM_STEP,
} from "./constants";
import { shallowEqualArrays, shallowEqualObjects } from "./equality";
import {
  drawabilityVersionAtom,
  fitWidthVersionAtom,
  formatDriverAtom,
} from "./format";
import { normalizeAnnotations } from "./normalize";
import { cancelScrollRequest, useRequestScroll } from "./scroll";
import type { ScrollTarget } from "./scroll";
import {
  AnnotatorProvider,
  useAnnotatorStore,
} from "./state/AnnotatorProvider";
import type { AnnotatorStore } from "./state/AnnotatorProvider";
import {
  activeHighlightIdAtom,
  annotationsAtom,
  DEFAULT_DISPLAY_SETTINGS,
  displaySettingsAtom,
  documentStatusAtom,
  editingAtom,
  highlightsAtom,
  instanceIdAtom,
  relationsAtom,
  rootElementAtom,
  selectedAnnotationIdsAtom,
  selectedRelationIdsAtom,
  zoomAtom,
  zoomInitialisedAtom,
} from "./state/atoms";
import type { DisplaySettings } from "./state/atoms";
import {
  useControllable,
  useLastUserValue,
  useSetControllable,
} from "./state/controllable";
import type {
  AnnotatorCommonProps,
  AnnotatorHandle,
  ChangeInfo,
  Highlight,
  Relation,
} from "./types";

export interface AnnotatorShellProps<M = unknown> {
  common: AnnotatorCommonProps<M>;
  handleRef: Ref<AnnotatorHandle>;
  /**
   * The format's renderer. Always rendered: it decides what to show while
   * the document loads.
   */
  children: ReactNode;
}

export function AnnotatorShell<M = unknown>(props: AnnotatorShellProps<M>) {
  return (
    <AnnotatorProvider>
      <ShellBody {...props} />
    </AnnotatorProvider>
  );
}

const API: ChangeInfo = Object.freeze({ source: "api" });

const EMPTY_IDS: string[] = Object.freeze([]) as unknown as string[];
const EMPTY_RELATIONS: Relation[] = Object.freeze([]) as unknown as Relation[];
const EMPTY_HIGHLIGHTS: Highlight[] = Object.freeze(
  []
) as unknown as Highlight[];

/** Zoom before a fit-to-width initial zoom has been resolved. */
const NATURAL_ZOOM = 1;

/** Layout of the root plus the theming custom properties with defaults. */
const ROOT_STYLE = Object.freeze({
  overflow: "auto",
  height: "100%",
  position: "relative",
  "--rca-font-family": THEME_DEFAULTS.fontFamily,
  "--rca-z-annotation": THEME_DEFAULTS.zAnnotation,
  "--rca-z-highlight": THEME_DEFAULTS.zHighlight,
  "--rca-z-pending": THEME_DEFAULTS.zPending,
  "--rca-structural-color": THEME_DEFAULTS.structuralColor,
}) as CSSProperties;

/**
 * One write the handle made whose arrival must not raise the scroll request a
 * change normally raises: `selectAnnotations` with `{ scroll: false }`, and
 * the select / activate step of `scrollTo…`, which raises its own bounded
 * request. It lives until the commit after the write (`dueTick`): the handle
 * forces that commit, so a host that applies the write synchronously has it
 * in the store by then, and a write the host declines (or echoes as an equal
 * value the bridge drops) cannot silence a later, unrelated change. The cost:
 * a host that applies it asynchronously gets the scroll anyway.
 */
type QuietWrite<T> = { value: T; dueTick: number } | null;
type QuietSlot<T> = MutableRefObject<QuietWrite<T>>;
type QuietWrites = {
  selection: QuietSlot<string[]>;
  highlight: QuietSlot<string | null>;
  /** Records a quiet write in `slot` and forces the commit that expires it. */
  mark<T>(slot: QuietSlot<T>, value: T): void;
};

function ShellBody<M>({ common, handleRef, children }: AnnotatorShellProps<M>) {
  const store = useAnnotatorStore("AnnotatorShell");
  const [tick, forceCommit] = useReducer((n: number) => n + 1, 0);
  const committedTick = useRef(tick);
  useLayoutEffect(() => {
    committedTick.current = tick;
  });
  const selectionSlot = useRef<QuietWrite<string[]>>(null);
  const highlightSlot = useRef<QuietWrite<string | null>>(null);
  const quiet = useMemo<QuietWrites>(
    () => ({
      selection: selectionSlot,
      highlight: highlightSlot,
      mark(slot, value) {
        slot.current = { value, dueTick: committedTick.current + 1 };
        forceCommit();
      },
    }),
    []
  );

  useBridgedState(store, common);
  usePropSync(store, common);
  const applyZoom = useApplyZoom(store);
  useInitialFitWidth(store, applyZoom);
  const scrollOnSelect = common.scrollOnSelect ?? true;
  useSelectionScroll(store, tick, scrollOnSelect, selectionSlot);
  useHighlightScroll(store, tick, highlightSlot);
  useDocumentLifecycle(store, common);

  const handle = useHandle(store, applyZoom, quiet);
  useImperativeHandle(handleRef, () => handle, [handle]);
  useEffect(() => () => cancelScrollRequest(store), [store]);

  const instanceId = useAtomValue(instanceIdAtom, { store });
  const status = useAtomValue(documentStatusAtom, { store });
  const setRoot = useCallback(
    (element: HTMLDivElement | null) => store.set(rootElementAtom, element),
    [store]
  );

  return (
    <div
      ref={setRoot}
      data-rca-root=""
      data-rca-instance={instanceId}
      className={common.className}
      style={common.style ? { ...ROOT_STYLE, ...common.style } : ROOT_STYLE}
    >
      {children}
      {status.state === "loading" && common.renderLoading?.(status.progress)}
      {status.state === "error" &&
        status.error &&
        common.renderError?.(status.error)}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Props into the store
// ---------------------------------------------------------------------------

/** Selection, zoom and active highlight: controlled or internal. */
function useBridgedState<M>(
  store: AnnotatorStore,
  common: AnnotatorCommonProps<M>
): void {
  const { zoom, defaultZoom = "fit-width" } = common;

  useControllable<string[]>("selection", {
    value: common.selectedAnnotationIds,
    defaultValue: common.defaultSelectedAnnotationIds ?? EMPTY_IDS,
    onChange: (ids, info) => common.onSelectionChange?.(ids, info),
    equals: shallowEqualArrays,
  });
  useControllable<number>("zoom", {
    value: zoom,
    defaultValue: typeof defaultZoom === "number" ? defaultZoom : NATURAL_ZOOM,
    onChange: (next) => common.onZoomChange?.(next),
  });
  useControllable<string | null>("activeHighlight", {
    value: common.activeHighlightId,
    defaultValue: common.defaultActiveHighlightId ?? null,
    onChange: (id) => common.onActiveHighlightChange?.(id),
  });

  // A zoom given as a number needs no fit-to-width resolution. Seeded on the
  // first render, like the bridged values, so the format's first render
  // already sees it.
  const seeded = useRef(false);
  if (!seeded.current) {
    seeded.current = true;
    if (zoom !== undefined || typeof defaultZoom === "number") {
      store.set(zoomInitialisedAtom, true);
    }
  }
  useLayoutEffect(() => {
    if (zoom !== undefined) store.set(zoomInitialisedAtom, true);
  }, [store, zoom]);
}

/** Writes `next` unless the atom already holds the same elements. */
function writeList<T>(
  store: AnnotatorStore,
  target: PrimitiveAtom<T[]>,
  next: T[]
): void {
  store.set(target, (prev) => (shallowEqualArrays(prev, next) ? prev : next));
}

function sameDisplaySettings(a: DisplaySettings, b: DisplaySettings): boolean {
  return (
    a.showStructural === b.showStructural &&
    a.showStructuralRelationships === b.showStructuralRelationships &&
    a.showSelectedOnly === b.showSelectedOnly &&
    a.showBoundingBoxes === b.showBoundingBoxes &&
    a.labelDisplay === b.labelDisplay &&
    (a.visibleLabelIds === b.visibleLabelIds ||
      (a.visibleLabelIds !== null &&
        b.visibleLabelIds !== null &&
        shallowEqualArrays(a.visibleLabelIds, b.visibleLabelIds)))
  );
}

/**
 * Data, display settings and editing state. Every write is skipped when the
 * store already holds an equal value, so a host that passes new arrays or
 * objects on every render wakes no subscriber.
 */
function usePropSync<M>(
  store: AnnotatorStore,
  common: AnnotatorCommonProps<M>
): void {
  const {
    annotations,
    relations = EMPTY_RELATIONS,
    highlights = EMPTY_HIGHLIGHTS,
    selectedRelationIds = EMPTY_IDS,
    showStructural = DEFAULT_DISPLAY_SETTINGS.showStructural,
    showStructuralRelationships = DEFAULT_DISPLAY_SETTINGS
      .showStructuralRelationships,
    showSelectedOnly = DEFAULT_DISPLAY_SETTINGS.showSelectedOnly,
    showBoundingBoxes = DEFAULT_DISPLAY_SETTINGS.showBoundingBoxes,
    labelDisplay = DEFAULT_DISPLAY_SETTINGS.labelDisplay,
    visibleLabelIds = DEFAULT_DISPLAY_SETTINGS.visibleLabelIds,
    readOnly = false,
    activeLabel = null,
  } = common;

  useLayoutEffect(() => {
    // Normalisation is memoised per annotation object, so an equal list of
    // the same objects normalises to the same elements and is not written.
    writeList(store, annotationsAtom, normalizeAnnotations(annotations));
  }, [store, annotations]);

  useLayoutEffect(() => {
    writeList(store, relationsAtom, relations);
  }, [store, relations]);

  useLayoutEffect(() => {
    writeList(store, highlightsAtom, highlights);
  }, [store, highlights]);

  useLayoutEffect(() => {
    writeList(store, selectedRelationIdsAtom, selectedRelationIds);
  }, [store, selectedRelationIds]);

  useLayoutEffect(() => {
    const next: DisplaySettings = {
      showStructural,
      showStructuralRelationships,
      showSelectedOnly,
      showBoundingBoxes,
      labelDisplay,
      visibleLabelIds,
    };
    store.set(displaySettingsAtom, (prev) =>
      sameDisplaySettings(prev, next) ? prev : next
    );
  }, [
    store,
    showStructural,
    showStructuralRelationships,
    showSelectedOnly,
    showBoundingBoxes,
    labelDisplay,
    visibleLabelIds,
  ]);

  useLayoutEffect(() => {
    store.set(editingAtom, (prev) =>
      prev.readOnly === readOnly &&
      shallowEqualObjects(prev.activeLabel, activeLabel)
        ? prev
        : { readOnly, activeLabel }
    );
  }, [store, readOnly, activeLabel]);
}

// ---------------------------------------------------------------------------
// Zoom
// ---------------------------------------------------------------------------

function clampZoom(zoom: number): number {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom));
}

function roundZoom(zoom: number): number {
  return Number(zoom.toFixed(ZOOM_DECIMALS));
}

/** A usable fit-to-width zoom from the driver, or null while unmeasurable. */
function measuredFitWidth(store: AnnotatorStore): number | null {
  const fit = store.get(formatDriverAtom)?.resolveFitWidth() ?? null;
  return fit !== null && Number.isFinite(fit) && fit > 0 ? fit : null;
}

/**
 * Sets the zoom (clamped) as an api change, and marks the initial zoom as
 * decided so a later fit-to-width resolution does not override it.
 */
function useApplyZoom(store: AnnotatorStore): (zoom: number) => void {
  const setZoom = useSetControllable<number>("zoom");
  return useCallback(
    (zoom: number) => {
      setZoom(clampZoom(zoom), API);
      store.set(zoomInitialisedAtom, true);
    },
    [store, setZoom]
  );
}

/**
 * Resolves the default `"fit-width"` initial zoom as soon as the driver can
 * measure it: on registration and whenever the format reports that the
 * fit-to-width zoom may have changed.
 */
function useInitialFitWidth(
  store: AnnotatorStore,
  applyZoom: (zoom: number) => void
): void {
  const driver = useAtomValue(formatDriverAtom, { store });
  const fitWidthVersion = useAtomValue(fitWidthVersionAtom, { store });
  const initialised = useAtomValue(zoomInitialisedAtom, { store });
  useLayoutEffect(() => {
    if (initialised || !driver) return;
    const fit = measuredFitWidth(store);
    if (fit !== null) applyZoom(fit);
  }, [store, applyZoom, driver, fitWidthVersion, initialised]);
}

// ---------------------------------------------------------------------------
// Document lifecycle callbacks
// ---------------------------------------------------------------------------

/**
 * Fires `onDocumentLoad` once per transition of the document status to
 * `"ready"` (again after a reload), as soon as a driver is registered to
 * answer it, and `onError` once per transition to `"error"`. The callbacks
 * are read at firing time, so new inline callbacks never re-fire them.
 */
function useDocumentLifecycle<M>(
  store: AnnotatorStore,
  common: AnnotatorCommonProps<M>
): void {
  const { state, error } = useAtomValue(documentStatusAtom, { store });
  const driver = useAtomValue(formatDriverAtom, { store });
  const callbacks = useRef(common);
  useLayoutEffect(() => {
    callbacks.current = common;
  });
  /** The state last reported; null while loading. */
  const reported = useRef<"ready" | "error" | null>(null);

  useEffect(() => {
    if (state === "loading") {
      reported.current = null;
      return;
    }
    if (reported.current === state) return;
    if (state === "ready") {
      if (!driver) return;
      reported.current = state;
      callbacks.current.onDocumentLoad?.({
        pageCount: driver.getPageCount(),
        text: driver.getText(),
      });
      return;
    }
    reported.current = state;
    if (error) callbacks.current.onError?.(error);
  }, [state, error, driver]);
}

// ---------------------------------------------------------------------------
// Scroll requests raised by changes
// ---------------------------------------------------------------------------

type ChangeScroll<T> = {
  key: "selection" | "activeHighlight";
  kind: ScrollTarget["kind"];
  /** The bridged value. */
  valueAtom: Atom<T>;
  /** The id to scroll to for a value; null when there is nothing. */
  idOf: (value: T) => string | null;
  /** The document data the id must appear in before the change is handled. */
  dataAtom: Atom<readonly { id: string }[]>;
  equals: (a: T, b: T) => boolean;
  /** Whether a change may raise a request; read when the change is handled. */
  enabled: boolean;
  quiet: QuietSlot<T>;
};

/**
 * Raises one unbounded request per change of a bridged value, once the
 * document is ready and the target exists. A value present when the document
 * finishes loading counts as a change (the deep-link case). A change is not
 * scrolled to when it is the host echoing back a user change, when the handle
 * wrote it quietly, or when `enabled` is off. A change still waiting (its id
 * not in the data yet, or not drawable yet) is not consumed; it is looked at
 * again after every commit, and the subscriptions below make every input
 * that matters commit.
 *
 * The decision reads the store at effect time rather than this render's
 * values: a controlled value lands in the store during the commit (the
 * bridge's layout effect), after this render read it, and a quiet write must
 * be matched in that same commit.
 */
function useScrollOnChange<T>(
  store: AnnotatorStore,
  tick: number,
  {
    key,
    kind,
    valueAtom,
    idOf,
    dataAtom,
    equals,
    enabled,
    quiet,
  }: ChangeScroll<T>
): void {
  useAtomValue(valueAtom, { store });
  useAtomValue(dataAtom, { store });
  useAtomValue(documentStatusAtom, { store });
  useAtomValue(formatDriverAtom, { store });
  useAtomValue(drawabilityVersionAtom, { store });
  const lastUser = useLastUserValue<T>(key);
  const requestScroll = useRequestScroll();

  const latest = useRef({ equals, enabled });
  useLayoutEffect(() => {
    latest.current = { equals, enabled };
  });
  /** The value last handled; null until one is, and again after a reload. */
  const handled = useRef<{ value: T } | null>(null);
  /** The user-write version already accounted for. */
  const seenUserVersion = useRef(0);

  useEffect(() => {
    const marker = quiet.current;
    const { equals: same, enabled: allowed } = latest.current;

    /** Handles a pending change; true when it used the quiet marker. */
    const handleChange = (): boolean => {
      if (store.get(documentStatusAtom).state !== "ready") {
        handled.current = null;
        return false;
      }
      const driver = store.get(formatDriverAtom);
      if (!driver) return false;
      const value = store.get(valueAtom);
      if (handled.current && Object.is(handled.current.value, value)) {
        return false;
      }
      const id = idOf(value);
      if (id !== null && !store.get(dataAtom).some((item) => item.id === id)) {
        return false; // wait for the id to arrive
      }

      // An echo may arrive late (an async host), so a user write stays
      // eligible until the next change is handled. The trade-off: a host that
      // declines a user write and later sets the same value itself gets no
      // scroll for it.
      const userVersion = lastUser.version;
      const userEcho =
        userVersion !== seenUserVersion.current &&
        same(lastUser.current as T, value);
      seenUserVersion.current = userVersion;
      const quietWrite = marker !== null && same(marker.value, value);

      if (id === null || userEcho || quietWrite || !allowed) {
        handled.current = { value };
        return quietWrite;
      }
      const target: ScrollTarget = { kind, id };
      if (!driver.canDraw(target)) return false; // ask again later
      handled.current = { value };
      void requestScroll(target);
      return false;
    };

    const used = handleChange();
    if (marker !== null && quiet.current === marker) {
      if (used || tick >= marker.dueTick) quiet.current = null;
    }
  });
}

/**
 * Scroll to the first selected annotation when the selection changes, and to
 * the selection present when the document finishes loading (spec "Scroll
 * requests", rules 1 and 2). `scrollOnSelect={false}` turns both off.
 */
function useSelectionScroll(
  store: AnnotatorStore,
  tick: number,
  scrollOnSelect: boolean,
  quiet: QuietSlot<string[]>
): void {
  useScrollOnChange(store, tick, {
    key: "selection",
    kind: "annotation",
    valueAtom: selectedAnnotationIdsAtom,
    idOf: firstSelectedId,
    dataAtom: annotationsAtom,
    equals: shallowEqualArrays,
    enabled: scrollOnSelect,
    quiet,
  });
}

function firstSelectedId(ids: string[]): string | null {
  return ids[0] ?? null;
}

/** Scroll to the active highlight when it changes (spec rule 3). */
function useHighlightScroll(
  store: AnnotatorStore,
  tick: number,
  quiet: QuietSlot<string | null>
): void {
  useScrollOnChange(store, tick, {
    key: "activeHighlight",
    kind: "highlight",
    valueAtom: activeHighlightIdAtom,
    idOf: activeId,
    dataAtom: highlightsAtom,
    equals: Object.is,
    enabled: true,
    quiet,
  });
}

function activeId(id: string | null): string | null {
  return id;
}

// ---------------------------------------------------------------------------
// The handle
// ---------------------------------------------------------------------------

/**
 * The pending-selection methods while the shell keeps no pending selection:
 * there is never one to read, commit or clear.
 */
const noPendingSelection: Pick<
  AnnotatorHandle,
  "getPendingSelection" | "commitPendingSelection" | "clearPendingSelection"
> = {
  getPendingSelection: () => null,
  commitPendingSelection: () => {},
  clearPendingSelection: () => {},
};

/**
 * One handle object for the life of the instance; every method reads the
 * store at call time.
 */
function useHandle(
  store: AnnotatorStore,
  applyZoom: (zoom: number) => void,
  quiet: QuietWrites
): AnnotatorHandle {
  const setSelection = useSetControllable<string[]>("selection");
  const setActiveHighlight = useSetControllable<string | null>(
    "activeHighlight"
  );
  const requestScroll = useRequestScroll();

  return useMemo<AnnotatorHandle>(() => {
    const driver = () => store.get(formatDriverAtom);
    const drawable = (target: ScrollTarget) =>
      driver()?.canDraw(target) ?? false;

    return {
      scrollToAnnotation(id, opts = {}) {
        const target: ScrollTarget = { kind: "annotation", id };
        if (!drawable(target)) return Promise.resolve(false);
        if (opts.select) {
          quiet.mark(quiet.selection, [id]);
          setSelection([id], API);
        }
        return requestScroll(target, {
          behavior: opts.behavior,
          bounded: true,
        });
      },

      scrollToHighlight(id, opts = {}) {
        const target: ScrollTarget = { kind: "highlight", id };
        if (!drawable(target)) return Promise.resolve(false);
        if (opts.activate) {
          quiet.mark(quiet.highlight, id);
          setActiveHighlight(id, API);
        }
        return requestScroll(target, {
          behavior: opts.behavior,
          bounded: true,
        });
      },

      scrollToPage(pageIndex, opts = {}) {
        const scrolled =
          driver()?.scrollToPage(
            pageIndex,
            opts.behavior ?? DEFAULT_SCROLL_BEHAVIOR
          ) ?? false;
        // A page jump is the newest request: an older one still in flight
        // must not pull the view back when its target mounts.
        if (scrolled) cancelScrollRequest(store);
        return scrolled;
      },

      getZoom: () => store.get(zoomAtom),
      setZoom(zoom) {
        if (zoom !== "fit-width") return applyZoom(zoom);
        const fit = measuredFitWidth(store);
        if (fit !== null) applyZoom(fit);
      },
      zoomIn: () => applyZoom(roundZoom(store.get(zoomAtom) + ZOOM_STEP)),
      zoomOut: () => applyZoom(roundZoom(store.get(zoomAtom) - ZOOM_STEP)),

      getSelectedAnnotationIds: () => [...store.get(selectedAnnotationIdsAtom)],
      selectAnnotations(ids, opts = {}) {
        const next = [...ids];
        if (opts.scroll === false) quiet.mark(quiet.selection, next);
        else quiet.selection.current = null;
        setSelection(next, API);
      },
      clearSelection() {
        quiet.selection.current = null;
        setSelection([], API);
      },

      ...noPendingSelection,

      getPageCount: () => driver()?.getPageCount() ?? null,
      getVisiblePageRange: () => driver()?.getVisiblePageRange() ?? null,
      getText: () => driver()?.getText() ?? "",
      findText: (query, opts) => driver()?.findText(query, opts) ?? [],
      getScrollContainer: () => store.get(rootElementAtom),
    };
  }, [
    store,
    applyZoom,
    quiet,
    setSelection,
    setActiveHighlight,
    requestScroll,
  ]);
}
