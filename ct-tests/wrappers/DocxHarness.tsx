/**
 * The one DOCX test harness: a 900 x 700 box with a `DocxAnnotator` showing
 * `fixtures/docx/test.docx` with its text and annotations, fetched at runtime
 * from `/fixtures/**` (served by `serveFixtures`), and docxodus' runtime
 * from `DOCXODUS_WASM_URL` (served by `setupDocxodusWasm`). Like
 * `PdfHarness`, it exposes the handle and a log of every callback on
 * `window` (see `helpers/harness.ts`); the harness named `"default"` also
 * uses the short names `window.__rca` / `window.__rcaEvents`.
 *
 * - `mode: "controlled"` passes defined `zoom` / `selectedAnnotationIds` /
 *   `activeHighlightId` props (from `props`, else 1 / [] / null) and never
 *   applies a change callback itself: a test changes them with
 *   `component.update(...)`.
 * - `annotationIds` picks fixture annotations by id (default: all of them,
 *   `d-bad-span` included).
 * - `props` are passed through last; callbacks in it are called after the
 *   harness has logged the call.
 * - `omitCallbacks` names callback props the harness does not pass at all.
 * - `selectionMenu` passes a `renderSelectionMenu`: `[data-harness-menu]`
 *   with an Apply button, `[data-harness-apply]`, that commits the pending
 *   selection.
 * - `addCreated` does what a host does with `onCreateAnnotation`: each draft
 *   is added to the annotations it passes, as `created-<n>` (n from 1).
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";

import type {
  Annotation,
  AnnotationDraft,
  DocxAnnotatorProps,
} from "../../src/core/index";
import { DocxAnnotator } from "../../src/docx/index";
import { DOCXODUS_WASM_URL } from "../helpers/docxodusWasm";
import {
  createdAnnotation,
  DEFAULT_NAME,
  eventLog,
  loggedCallbacks,
  renderMenu,
  useHandleSetter,
} from "./harnessShared";
import type { CallbackName } from "./harnessShared";

export interface DocxHarnessProps {
  mode?: "uncontrolled" | "controlled";
  annotationIds?: string[];
  props?: Partial<DocxAnnotatorProps>;
  omitCallbacks?: CallbackName[];
  selectionMenu?: boolean;
  addCreated?: boolean;
  /** Addresses the harness from the test; default `"default"`. */
  name?: string;
}

const SIZE: CSSProperties = { width: 900, height: 700, flex: "none" };
const CONTROLLED_DEFAULT_ZOOM = 1;
const NO_IDS: string[] = [];

const FIXTURE = {
  docx: "/fixtures/docx/test.docx",
  text: "/fixtures/docx/text.txt",
  annotations: "/fixtures/docx/annotations.json",
} as const;

type FixtureData = { text: string; annotations: Annotation[] };

async function fetchOk(url: string): Promise<Response> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return response;
}

export function DocxHarness({
  mode = "uncontrolled",
  annotationIds,
  props = {},
  omitCallbacks = [],
  selectionMenu = false,
  addCreated = false,
  name = DEFAULT_NAME,
}: DocxHarnessProps) {
  const [data, setData] = useState<FixtureData | null>(null);
  const [created, setCreated] = useState<Annotation[]>([]);
  // Created during the first render: the annotator's own effects can fire
  // callbacks before any effect of this component runs.
  const [log] = useState(() => eventLog(name));
  const setHandle = useHandleSetter(name);

  useEffect(() => {
    let live = true;
    void Promise.all([
      fetchOk(FIXTURE.text).then((r) => r.text()),
      fetchOk(FIXTURE.annotations).then(
        (r) => r.json() as Promise<Annotation[]>
      ),
    ]).then(([text, annotations]) => {
      if (live) setData({ text, annotations });
    });
    return () => {
      live = false;
    };
  }, []);

  const annotations = useMemo(
    () => [
      ...(data?.annotations ?? []).filter(
        (a) => !annotationIds || annotationIds.includes(a.id)
      ),
      ...created,
    ],
    [data, annotationIds, created]
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
      <DocxAnnotator
        ref={setHandle}
        source={{ url: FIXTURE.docx }}
        text={data.text}
        wasmBaseUrl={DOCXODUS_WASM_URL}
        annotations={annotations}
        renderSelectionMenu={selectionMenu ? renderMenu : undefined}
        {...props}
        {...controlled}
        {...loggedCallbacks(
          log,
          { ...props, onCreateAnnotation },
          omitCallbacks
        )}
      />
    </div>
  );
}
