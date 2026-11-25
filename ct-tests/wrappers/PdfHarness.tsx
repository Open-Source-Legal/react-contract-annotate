/**
 * The one PDF test harness: a 900 x 700 box with a `PdfAnnotator` showing a
 * fixture fetched at runtime from `/fixtures/**` (served by `serveFixtures`).
 * It exposes the handle and a log of every callback on `window` (see
 * `helpers/harness.ts`); the harness named `"default"` also uses the short
 * names `window.__rca` / `window.__rcaEvents`.
 *
 * - `mode: "controlled"` passes defined `zoom` / `selectedAnnotationIds` /
 *   `activeHighlightId` props (from `props`, else 1 / [] / null) and never
 *   applies a change callback itself: a test changes them with
 *   `component.update(...)`.
 * - `annotationIds` picks fixture annotations by id (default: all of them).
 * - `linkUrls` replaces the `linkUrl` of the fixture annotations it names.
 * - `withPawls: false` leaves out the fixture's PAWLs (usc has none).
 * - `props` are passed through last; callbacks in it are called after the
 *   harness has logged the call.
 * - `omitCallbacks` names callback props the harness does not pass at all
 *   (neither logged nor from `props`), for tests of the behaviour without
 *   them.
 *
 * The fixture's relations are always passed.
 *
 * When `fixture` or `withPawls` changes, the annotator stays mounted and
 * keeps the previous fixture until the new one's data has been fetched; then
 * its PDF, PAWLs, annotations and relations are passed together, so a PDF is
 * never paired with another fixture's data.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";

import type {
  Annotation,
  AnnotatorHandle,
  PawlsInput,
  PdfAnnotatorProps,
  Relation,
} from "../../src/core/index";
import { PdfAnnotator } from "../../src/pdf/index";
import type { HarnessEvent } from "../helpers/harness";

export interface PdfHarnessProps {
  mode?: "uncontrolled" | "controlled";
  annotationIds?: string[];
  linkUrls?: Record<string, string>;
  withPawls?: boolean;
  fixture?: "eton" | "usc";
  props?: Partial<PdfAnnotatorProps>;
  omitCallbacks?: CallbackName[];
  /** Addresses the harness from the test; default `"default"`. */
  name?: string;
}

const DEFAULT_NAME = "default";
const SIZE: CSSProperties = { width: 900, height: 700, flex: "none" };
const CONTROLLED_DEFAULT_ZOOM = 1;
const NO_IDS: string[] = [];

const FIXTURES = {
  eton: {
    pdf: "/fixtures/eton/eton-agreement.pdf",
    pawls: "/fixtures/eton/pawls.json",
    annotations: "/fixtures/eton/annotations.json",
    relations: "/fixtures/eton/relations.json",
  },
  usc: {
    pdf: "/fixtures/usc/usc-title-1.pdf",
    pawls: null,
    annotations: null,
    relations: null,
  },
} as const;

/** One fixture's data, with the URL of the PDF it belongs to. */
type FixtureData = {
  pdf: string;
  pawls: PawlsInput | null;
  annotations: Annotation[];
  relations: Relation[];
};

async function fetchJson<T>(url: string | null, fallback: T): Promise<T> {
  if (url === null) return fallback;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return (await response.json()) as T;
}

/** Every callback prop of the annotator, each logged as it fires. */
const CALLBACKS = [
  "onSelectionChange",
  "onZoomChange",
  "onActiveHighlightChange",
  "onCreateAnnotation",
  "onTextSelect",
  "onAnnotationClick",
  "onAnnotationHover",
  "onOpenLink",
  "onDocumentLoad",
  "onError",
  "onVisiblePagesChange",
] as const satisfies readonly (keyof PdfAnnotatorProps)[];

export type CallbackName = (typeof CALLBACKS)[number];

/** The log of the harness `name`, created on first use. */
function eventLog(name: string): HarnessEvent[] {
  const logs = (window.__rcaEventLogs ??= {});
  const log = (logs[name] ??= []);
  if (name === DEFAULT_NAME) window.__rcaEvents = log;
  return log;
}

function loggedCallbacks(
  log: HarnessEvent[],
  props: Partial<PdfAnnotatorProps>,
  omit: readonly CallbackName[]
): Pick<PdfAnnotatorProps, CallbackName> {
  const callbacks: Partial<Record<CallbackName, unknown>> = {};
  for (const callback of CALLBACKS) {
    if (omit.includes(callback)) {
      callbacks[callback] = undefined;
      continue;
    }
    const own = props[callback] as
      | ((...args: unknown[]) => unknown)
      | undefined;
    callbacks[callback] = (...args: unknown[]) => {
      log.push([callback, ...args]);
      return own?.(...args);
    };
  }
  return callbacks as Pick<PdfAnnotatorProps, CallbackName>;
}

/** The fixture annotations picked by `ids`, with `linkUrls` applied. */
function pickAnnotations(
  all: Annotation[],
  ids: string[] | undefined,
  linkUrls: Record<string, string> | undefined
): Annotation[] {
  const picked = ids ? all.filter((a) => ids.includes(a.id)) : all;
  if (!linkUrls) return picked;
  return picked.map((a) =>
    Object.hasOwn(linkUrls, a.id) ? { ...a, linkUrl: linkUrls[a.id] } : a
  );
}

export function PdfHarness({
  mode = "uncontrolled",
  annotationIds,
  linkUrls,
  withPawls = true,
  fixture = "eton",
  props = {},
  omitCallbacks = [],
  name = DEFAULT_NAME,
}: PdfHarnessProps) {
  const files = FIXTURES[fixture];
  const [data, setData] = useState<FixtureData | null>(null);
  // Created during the first render: the annotator's own effects can fire
  // callbacks before any effect of this component runs.
  const [log] = useState(() => eventLog(name));

  useEffect(() => {
    let live = true;
    void Promise.all([
      fetchJson<PawlsInput | null>(withPawls ? files.pawls : null, null),
      fetchJson<Annotation[]>(files.annotations, []),
      fetchJson<Relation[]>(files.relations, []),
    ]).then(([pawls, annotations, relations]) => {
      if (live) setData({ pdf: files.pdf, pawls, annotations, relations });
    });
    return () => {
      live = false;
    };
  }, [files, withPawls]);

  const setHandle = useCallback(
    (handle: AnnotatorHandle | null) => {
      (window.__rcaHandles ??= {})[name] = handle;
      if (name === DEFAULT_NAME) window.__rca = handle;
    },
    [name]
  );

  // Memoised: annotations with `linkUrls` applied are new objects, and a new
  // annotation object on every render would be renormalised every render.
  const annotations = useMemo(
    () => pickAnnotations(data?.annotations ?? [], annotationIds, linkUrls),
    [data, annotationIds, linkUrls]
  );

  if (!data) return <div data-harness={name} style={SIZE} />;

  const controlled =
    mode === "controlled"
      ? {
          zoom: props.zoom ?? CONTROLLED_DEFAULT_ZOOM,
          selectedAnnotationIds: props.selectedAnnotationIds ?? NO_IDS,
          activeHighlightId: props.activeHighlightId ?? null,
        }
      : {};

  return (
    <div data-harness={name} style={SIZE}>
      <PdfAnnotator
        ref={setHandle}
        source={{ url: data.pdf }}
        pawls={data.pawls}
        annotations={annotations}
        relations={data.relations}
        {...props}
        {...controlled}
        {...loggedCallbacks(log, props, omitCallbacks)}
      />
    </div>
  );
}
