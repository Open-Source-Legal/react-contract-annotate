/**
 * One viewer with the host-side controls around it. The controls are plain
 * HTML outside the viewer: the library ships none. They drive the viewer
 * through its handle (zoom, jump, search) and through props (the label to
 * apply, the highlights to paint).
 *
 * In "controlled" mode the host owns the zoom, the selection and the active
 * highlight and passes them as props, applying each change the viewer reports;
 * in "internal" mode the viewer owns them and the callbacks only notify. The
 * parent remounts this component when the mode or the format changes.
 */
import { DocumentAnnotator } from "@os-legal/react-contract-annotate";
import type {
  Annotation,
  AnnotationDraft,
  AnnotationLabel,
  AnnotatorHandle,
  Highlight,
} from "@os-legal/react-contract-annotate";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { DemoDocument } from "./documents";

export type Mode = "controlled" | "internal";

interface ViewerProps {
  demo: DemoDocument;
  mode: Mode;
  /** The annotations the user has created so far, owned by the host. */
  created: Annotation[];
  onCreate(draft: AnnotationDraft): void;
  log(name: string, detail?: string): void;
}

/** The zoom a controlled viewer starts at (an internal one fits the width). */
const CONTROLLED_START_ZOOM = 1;
const PREVIEW_CHARACTERS = 40;

function preview(text: string | undefined): string {
  const flat = (text ?? "").replace(/\s+/g, " ").trim();
  return flat.length > PREVIEW_CHARACTERS
    ? `${flat.slice(0, PREVIEW_CHARACTERS)}…`
    : flat;
}

/** Each label of `annotations` once, in order of first use. */
function distinctLabels(annotations: Annotation[]): AnnotationLabel[] {
  const byId = new Map<string, AnnotationLabel>();
  for (const { annotationLabel } of annotations) {
    if (!byId.has(annotationLabel.id)) {
      byId.set(annotationLabel.id, annotationLabel);
    }
  }
  return [...byId.values()];
}

export function Viewer({ demo, mode, created, onCreate, log }: ViewerProps) {
  const handle = useRef<AnnotatorHandle>(null);
  const [zoom, setZoom] = useState(CONTROLLED_START_ZOOM);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [activeHighlightId, setActiveHighlightId] = useState<string | null>(
    null
  );
  const [highlights, setHighlights] = useState<Highlight[]>([]);
  const [activeLabel, setActiveLabel] = useState<AnnotationLabel | null>(null);
  const [query, setQuery] = useState("");

  // One array per change: the viewer treats annotations as immutable inputs.
  const annotations = useMemo(
    () => [...demo.annotations, ...created],
    [demo.annotations, created]
  );
  const labels = useMemo(() => distinctLabels(annotations), [annotations]);

  const showHit = useCallback(
    async (id: string) => {
      const scrolled = await handle.current?.scrollToHighlight(id, {
        activate: true,
      });
      log("scrollToHighlight", `${id} -> ${scrolled}`);
    },
    [log]
  );

  // A new set of search hits: show the first, from an effect of the render
  // that passes them to the viewer.
  const firstHitId = highlights[0]?.id;
  useEffect(() => {
    if (firstHitId !== undefined) void showHit(firstHitId);
  }, [highlights, firstHitId, showHit]);

  const activeHitIndex = highlights.findIndex(
    (h) => h.id === activeHighlightId
  );

  const find = () => {
    const hits = handle.current?.findText(query) ?? [];
    log("findText", `"${query}" -> ${hits.length} hits`);
    setHighlights(hits);
  };

  const nextHit = () => {
    if (highlights.length === 0) return;
    void showHit(highlights[(activeHitIndex + 1) % highlights.length].id);
  };

  const jumpTo = async (id: string) => {
    const scrolled = await handle.current?.scrollToAnnotation(id, {
      select: true,
    });
    log("scrollToAnnotation", `${id} -> ${scrolled}`);
  };

  // Defined props make a value controlled; left out, the viewer owns it.
  const controlled =
    mode === "controlled"
      ? { zoom, selectedAnnotationIds: selectedIds, activeHighlightId }
      : {};

  return (
    <>
      <div className="row">
        <span className="group">
          <button type="button" onClick={() => handle.current?.zoomOut()}>
            Zoom out
          </button>
          <button type="button" onClick={() => handle.current?.zoomIn()}>
            Zoom in
          </button>
          <button
            type="button"
            onClick={() => handle.current?.setZoom("fit-width")}
          >
            Fit width
          </button>
        </span>
        <label className="group">
          Jump to
          <select
            value=""
            onChange={(event) => {
              if (event.target.value) void jumpTo(event.target.value);
            }}
          >
            <option value="">annotation…</option>
            {annotations.map((a) => (
              <option key={a.id} value={a.id}>
                {a.id} · {a.annotationLabel.text} · {preview(a.rawText)}
              </option>
            ))}
          </select>
        </label>
        <label className="group">
          Label to apply
          <select
            value={activeLabel?.id ?? ""}
            onChange={(event) =>
              setActiveLabel(
                labels.find((l) => l.id === event.target.value) ?? null
              )
            }
          >
            <option value="">(none)</option>
            {labels.map((label) => (
              <option key={label.id} value={label.id}>
                {label.text}
              </option>
            ))}
          </select>
        </label>
      </div>
      <form
        className="row"
        onSubmit={(event) => {
          event.preventDefault();
          find();
        }}
      >
        <input
          type="text"
          value={query}
          placeholder="Find text"
          aria-label="Find text"
          onChange={(event) => setQuery(event.target.value)}
        />
        <button type="submit">Find</button>
        <button
          type="button"
          onClick={nextHit}
          disabled={highlights.length === 0}
        >
          Next hit
        </button>
        <span>
          {highlights.length === 0
            ? "no hits"
            : `hit ${activeHitIndex + 1} of ${highlights.length}`}
        </span>
      </form>
      <div className="viewer">
        <DocumentAnnotator
          ref={handle}
          document={demo.document}
          annotations={annotations}
          relations={demo.relations}
          highlights={highlights}
          activeLabel={activeLabel}
          {...controlled}
          onSelectionChange={(ids, info) => {
            setSelectedIds(ids);
            log("onSelectionChange", `[${ids.join(", ")}] by ${info.source}`);
          }}
          onZoomChange={(next) => {
            setZoom(next);
            log("onZoomChange", next.toFixed(2));
          }}
          onActiveHighlightChange={(id) => {
            setActiveHighlightId(id);
            log("onActiveHighlightChange", String(id));
          }}
          onCreateAnnotation={(draft) => {
            onCreate(draft);
            log(
              "onCreateAnnotation",
              `${draft.annotationLabel?.text}: "${preview(draft.rawText)}"`
            );
          }}
          onTextSelect={(pending) =>
            log("onTextSelect", `"${preview(pending.rawText)}"`)
          }
          onAnnotationClick={(annotation) =>
            log("onAnnotationClick", annotation.id)
          }
          onDocumentLoad={({ pageCount }) =>
            log(
              "onDocumentLoad",
              pageCount === null ? "unpaginated" : `${pageCount} pages`
            )
          }
          onError={(error) => log("onError", error.message)}
        />
      </div>
    </>
  );
}
