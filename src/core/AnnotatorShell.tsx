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
import type { PrimitiveAtom } from "jotai";
import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
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
import { fitWidthVersionAtom, formatDriverAtom } from "./format";
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
 * A selection or active highlight the handle wrote whose arrival must not
 * raise the scroll request a change normally raises: `selectAnnotations` with
 * `{ scroll: false }`, and the select / activate step of `scrollTo…`, which
 * raises its own bounded request. Consumed by the next change handled.
 */
type QuietWrite<T> = { value: T } | null;
type QuietWrites = {
  selection: MutableRefObject<QuietWrite<string[]>>;
  highlight: MutableRefObject<QuietWrite<string | null>>;
};

function ShellBody<M>({ common, handleRef, children }: AnnotatorShellProps<M>) {
  const store = useAnnotatorStore("AnnotatorShell");
  const quiet: QuietWrites = {
    selection: useRef<QuietWrite<string[]>>(null),
    highlight: useRef<QuietWrite<string | null>>(null),
  };

  useBridgedState(store, common);
  usePropSync(store, common);
  const applyZoom = useApplyZoom(store);
  useInitialFitWidth(store, applyZoom);
  useSelectionScroll(store, common.scrollOnSelect ?? true, quiet.selection);
  useHighlightScroll(store, quiet.highlight);
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
  /** The bridged value as the store holds it now. */
  value: T;
  /** What to scroll to for this value; null when there is nothing. */
  target: ScrollTarget | null;
  /** Whether the target's id is in the document data yet. */
  present: boolean;
  equals: (a: T, b: T) => boolean;
  /** Whether a change may raise a request; read when the change is handled. */
  enabled: boolean;
  quiet: MutableRefObject<QuietWrite<T>>;
};

/**
 * Raises one unbounded request per change of a bridged value, once the
 * document is ready and the target exists. A value present when the document
 * finishes loading counts as a change (the deep-link case); one whose target
 * is not in the data yet waits for it. A change is not scrolled to when it is
 * the host echoing back a user change, when the handle wrote it quietly, or
 * when `enabled` is off.
 */
function useScrollOnChange<T>(
  store: AnnotatorStore,
  { key, value, target, present, equals, enabled, quiet }: ChangeScroll<T>
): void {
  const ready = useAtomValue(documentStatusAtom, { store }).state === "ready";
  const driver = useAtomValue(formatDriverAtom, { store });
  const lastUser = useLastUserValue<T>(key);
  const requestScroll = useRequestScroll();

  const latest = useRef({ target, equals, enabled });
  useLayoutEffect(() => {
    latest.current = { target, equals, enabled };
  });
  /** The value last handled; null until one is, and again after a reload. */
  const handled = useRef<{ value: T } | null>(null);
  /** The user-write version already accounted for. */
  const seenUserVersion = useRef(0);

  const targetId = target?.id ?? null;
  useEffect(() => {
    if (!ready) {
      handled.current = null;
      return;
    }
    if (!driver) return;
    if (handled.current && Object.is(handled.current.value, value)) return;
    if (targetId !== null && !present) return;
    handled.current = { value };

    const { target: current, equals: same, enabled: allowed } = latest.current;
    const userVersion = lastUser.version;
    const userEcho =
      userVersion !== seenUserVersion.current &&
      same(lastUser.current as T, value);
    seenUserVersion.current = userVersion;
    const quietWrite =
      quiet.current !== null && same(quiet.current.value, value);
    quiet.current = null;

    if (!current || userEcho || quietWrite || !allowed) return;
    if (driver.canDraw(current)) void requestScroll(current);
  }, [ready, driver, value, targetId, present, lastUser, quiet, requestScroll]);
}

/**
 * Scroll to the first selected annotation when the selection changes, and to
 * the selection present when the document finishes loading (spec "Scroll
 * requests", rules 1 and 2). `scrollOnSelect={false}` turns both off.
 */
function useSelectionScroll(
  store: AnnotatorStore,
  scrollOnSelect: boolean,
  quiet: MutableRefObject<QuietWrite<string[]>>
): void {
  const selection = useAtomValue(selectedAnnotationIdsAtom, { store });
  const annotations = useAtomValue(annotationsAtom, { store });
  const firstId = selection[0] ?? null;
  const present = useMemo(
    () => firstId !== null && annotations.some((a) => a.id === firstId),
    [annotations, firstId]
  );
  useScrollOnChange(store, {
    key: "selection",
    value: selection,
    target: firstId === null ? null : { kind: "annotation", id: firstId },
    present,
    equals: shallowEqualArrays,
    enabled: scrollOnSelect,
    quiet,
  });
}

/** Scroll to the active highlight when it changes (spec rule 3). */
function useHighlightScroll(
  store: AnnotatorStore,
  quiet: MutableRefObject<QuietWrite<string | null>>
): void {
  const activeId = useAtomValue(activeHighlightIdAtom, { store });
  const highlights = useAtomValue(highlightsAtom, { store });
  const present = useMemo(
    () => activeId !== null && highlights.some((h) => h.id === activeId),
    [highlights, activeId]
  );
  useScrollOnChange(store, {
    key: "activeHighlight",
    value: activeId,
    target: activeId === null ? null : { kind: "highlight", id: activeId },
    present,
    equals: Object.is,
    enabled: true,
    quiet,
  });
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
          quiet.selection.current = { value: [id] };
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
          quiet.highlight.current = { value: id };
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
        if (opts.scroll === false) quiet.selection.current = { value: next };
        setSelection(next, API);
      },
      clearSelection: () => setSelection([], API),

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
    quiet.selection,
    quiet.highlight,
    setSelection,
    setActiveHighlight,
    requestScroll,
  ]);
}
