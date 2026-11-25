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
 * - `selectionMenu` passes a `renderSelectionMenu` (a test cannot pass a
 *   render function): `[data-harness-menu]` with an Apply button,
 *   `[data-harness-apply]`, that commits the pending selection.
 * - `addCreated` does what a host does with `onCreateAnnotation`: each draft
 *   is added to the annotations it passes, as `created-<n>` (n from 1).
 * - `freshPawls` passes a new copy of the fixture's PAWLs, equal to it, on
 *   every render (a host that normalises them inline).
 * - `rerenderOnCallbacks` re-renders the harness after every callback the
 *   annotator fires (a host that keeps what callbacks report in state).
 *
 * The fixture's relations are always passed.
 *
 * When `fixture` or `withPawls` changes, the annotator stays mounted and
 * keeps the previous fixture until the new one's data has been fetched; then
 * its PDF, PAWLs, annotations and relations are passed together, so a PDF is
 * never paired with another fixture's data.
 */
import { useCallback, useEffect, useMemo, useReducer, useState } from "react";
import type { CSSProperties } from "react";

import type {
  Annotation,
  AnnotationDraft,
  PawlsInput,
  PdfAnnotatorProps,
  Relation,
} from "../../src/core/index";
import { PdfAnnotator } from "../../src/pdf/index";
import {
  createdAnnotation,
  DEFAULT_NAME,
  eventLog,
  loggedCallbacks,
  renderMenu,
  useHandleSetter,
} from "./harnessShared";
import type { CallbackName } from "./harnessShared";

export interface PdfHarnessProps {
  mode?: "uncontrolled" | "controlled";
  annotationIds?: string[];
  linkUrls?: Record<string, string>;
  withPawls?: boolean;
  fixture?: "eton" | "usc";
  props?: Partial<PdfAnnotatorProps>;
  omitCallbacks?: CallbackName[];
  selectionMenu?: boolean;
  addCreated?: boolean;
  freshPawls?: boolean;
  rerenderOnCallbacks?: boolean;
  /** Addresses the harness from the test; default `"default"`. */
  name?: string;
}

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

/** A new PAWLs object equal to `pawls`, down to its pages. */
function copyPawls(pawls: PawlsInput): PawlsInput {
  return Array.isArray(pawls)
    ? pawls.map((page) => ({ ...page }))
    : { ...pawls, p: pawls.p.map((page) => ({ ...page })) };
}

export function PdfHarness({
  mode = "uncontrolled",
  annotationIds,
  linkUrls,
  withPawls = true,
  fixture = "eton",
  props = {},
  omitCallbacks = [],
  selectionMenu = false,
  addCreated = false,
  freshPawls = false,
  rerenderOnCallbacks = false,
  name = DEFAULT_NAME,
}: PdfHarnessProps) {
  const [, rerender] = useReducer((renders: number) => renders + 1, 0);
  const files = FIXTURES[fixture];
  const [data, setData] = useState<FixtureData | null>(null);
  const [created, setCreated] = useState<Annotation[]>([]);
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

  const setHandle = useHandleSetter(name);

  // Memoised: annotations with `linkUrls` applied are new objects, and a new
  // annotation object on every render would be renormalised every render.
  // Created annotations come after the fixture's.
  const annotations = useMemo(
    () => [
      ...pickAnnotations(data?.annotations ?? [], annotationIds, linkUrls),
      ...created,
    ],
    [data, annotationIds, linkUrls, created]
  );

  const ownCreate = props.onCreateAnnotation;
  const onCreateAnnotation = useCallback(
    (draft: AnnotationDraft) => {
      if (addCreated) {
        setCreated((prev) => [
          ...prev,
          createdAnnotation(draft, prev.length + 1),
        ]);
      }
      return ownCreate?.(draft);
    },
    [addCreated, ownCreate]
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
        pawls={freshPawls && data.pawls ? copyPawls(data.pawls) : data.pawls}
        annotations={annotations}
        relations={data.relations}
        renderSelectionMenu={selectionMenu ? renderMenu : undefined}
        {...props}
        {...controlled}
        {...loggedCallbacks(
          log,
          { ...props, onCreateAnnotation },
          omitCallbacks,
          rerenderOnCallbacks ? rerender : undefined
        )}
      />
    </div>
  );
}
