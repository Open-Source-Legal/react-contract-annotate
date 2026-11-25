/**
 * One document in the viewer with the demo's controls around it. The controls
 * are plain HTML outside the viewer: the library ships none. They drive it
 * through its handle (zoom, jump, search) and through props (what to show,
 * which labels, which relationship, the buttons beside a label), and every
 * callback it fires is logged.
 *
 * In "controlled" mode this component owns the zoom, the selection and the
 * active search hit and passes them as props, applying each change the viewer
 * reports; in "internal" mode the viewer owns them and the callbacks only
 * notify. The parent remounts this component when the mode or the document
 * changes.
 */
import { DocumentAnnotator } from "@os-legal/react-contract-annotate";
import type {
  Annotation,
  AnnotationAction,
  AnnotationDraft,
  AnnotatorHandle,
  Highlight,
  LabelDisplay,
  Relation,
} from "@os-legal/react-contract-annotate";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { DemoDocument } from "./documents";
import { useEventLog } from "./eventLog";
import { CopyIcon, TrashIcon } from "./icons";
import { SelectionMenu } from "./SelectionMenu";
import { Sidebar } from "./Sidebar";
import { preview } from "./text";

export type Mode = "controlled" | "internal";

interface WorkspaceProps {
  demo: DemoDocument;
  mode: Mode;
  /** The annotations the reader has made so far, owned by the page. */
  created: Annotation[];
  /** The ids of the annotations the reader has removed. */
  removedIds: string[];
  onCreate(draft: AnnotationDraft): void;
  onRemove(annotationId: string): void;
}

/** The zoom a controlled viewer starts at (an internal one fits the width). */
const CONTROLLED_START_ZOOM = 1;

const LABEL_DISPLAYS: { value: LabelDisplay; name: string }[] = [
  { value: "always", name: "Label names shown" },
  { value: "hover", name: "Label names on hover" },
  { value: "hide", name: "Label names hidden" },
];

function pageRange([first, last]: [number, number], count: number): string {
  const pages =
    first === last ? `Page ${first + 1}` : `Pages ${first + 1}–${last + 1}`;
  return `${pages} of ${count}`;
}

export function Workspace({
  demo,
  mode,
  created,
  removedIds,
  onCreate,
  onRemove,
}: WorkspaceProps) {
  const handle = useRef<AnnotatorHandle>(null);
  const { events, log } = useEventLog();
  const isPdf = demo.source.format === "pdf";

  const [zoom, setZoom] = useState(CONTROLLED_START_ZOOM);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [activeHighlightId, setActiveHighlightId] = useState<string | null>(
    null
  );
  const [highlights, setHighlights] = useState<Highlight[]>([]);
  const [query, setQuery] = useState("");
  const [hiddenLabelIds, setHiddenLabelIds] = useState<ReadonlySet<string>>(
    new Set()
  );
  const [showStructural, setShowStructural] = useState(false);
  const [labelDisplay, setLabelDisplay] = useState<LabelDisplay>("always");
  const [selectedRelationId, setSelectedRelationId] = useState<string | null>(
    null
  );
  const [pageCount, setPageCount] = useState<number | null>(null);
  const [visiblePages, setVisiblePages] = useState<[number, number] | null>(
    null
  );

  // One array per change: the viewer treats annotations as immutable inputs.
  const annotations = useMemo(
    () =>
      [...demo.annotations, ...created].filter(
        (annotation) => !removedIds.includes(annotation.id)
      ),
    [demo.annotations, created, removedIds]
  );

  // The buttons beside every annotation's label. The same array while
  // nothing they use changes, so the labels are not drawn again for nothing.
  const annotationActions = useMemo<AnnotationAction[]>(
    () => [
      {
        id: "copy",
        label: "Copy text",
        icon: <CopyIcon />,
        onClick: (annotation) => {
          void navigator.clipboard?.writeText(annotation.rawText ?? "");
          log("annotationActions copy", annotation.id);
        },
      },
      {
        id: "remove",
        label: "Remove",
        icon: <TrashIcon />,
        // The document's own structure is not the reader's to remove.
        isVisible: (annotation) => !annotation.structural,
        onClick: (annotation) => {
          onRemove(annotation.id);
          log("annotationActions remove", annotation.id);
        },
      },
    ],
    [log, onRemove]
  );

  // `null` shows every label; otherwise the ids left checked.
  const visibleLabelIds = useMemo(() => {
    if (hiddenLabelIds.size === 0) return null;
    const ids = new Set(annotations.map((a) => a.annotationLabel.id));
    return [...ids].filter((id) => !hiddenLabelIds.has(id));
  }, [annotations, hiddenLabelIds]);

  const toggleLabel = (labelId: string) =>
    setHiddenLabelIds((hidden) => {
      const next = new Set(hidden);
      if (!next.delete(labelId)) next.add(labelId);
      return next;
    });

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
    const hits = query.trim() ? handle.current?.findText(query) ?? [] : [];
    log("findText", `"${query}" -> ${hits.length} hits`);
    setHighlights(hits);
  };

  const stepHit = (step: 1 | -1) => {
    const count = highlights.length;
    if (count === 0) return;
    void showHit(highlights[(activeHitIndex + step + count) % count].id);
  };

  const jumpTo = async (id: string) => {
    const scrolled = await handle.current?.scrollToAnnotation(id, {
      select: true,
    });
    log("scrollToAnnotation", `${id} -> ${scrolled}`);
  };

  const selectRelation = (relation: Relation) => {
    if (relation.id === selectedRelationId) {
      setSelectedRelationId(null);
      handle.current?.clearSelection();
      return;
    }
    setSelectedRelationId(relation.id);
    handle.current?.selectAnnotations(
      [...relation.sourceIds, ...relation.targetIds],
      { scroll: false }
    );
    void handle.current?.scrollToAnnotation(relation.sourceIds[0]);
  };

  // Defined props make a value controlled; left out, the viewer owns it.
  const controlled =
    mode === "controlled"
      ? { zoom, selectedAnnotationIds: selectedIds, activeHighlightId }
      : {};

  return (
    <div className="workspace">
      <Sidebar
        annotations={annotations}
        relations={demo.relations}
        selectedIds={selectedIds}
        hiddenLabelIds={hiddenLabelIds}
        onToggleLabel={toggleLabel}
        showStructural={showStructural}
        onToggleStructural={() => setShowStructural((shown) => !shown)}
        onJump={(id) => void jumpTo(id)}
        selectedRelationId={selectedRelationId}
        onSelectRelation={selectRelation}
      />
      <section className="stage" aria-label={demo.title}>
        <div className="toolbar">
          <span className="cluster">
            <button
              type="button"
              aria-label="Zoom out"
              onClick={() => handle.current?.zoomOut()}
            >
              −
            </button>
            <output aria-label="Zoom">{Math.round(zoom * 100)}%</output>
            <button
              type="button"
              aria-label="Zoom in"
              onClick={() => handle.current?.zoomIn()}
            >
              +
            </button>
            <button
              type="button"
              onClick={() => handle.current?.setZoom("fit-width")}
            >
              Fit width
            </button>
          </span>
          <form
            className="cluster"
            role="search"
            onSubmit={(event) => {
              event.preventDefault();
              find();
            }}
          >
            <input
              type="search"
              value={query}
              placeholder="Find in document"
              aria-label="Find in document"
              onChange={(event) => setQuery(event.target.value)}
            />
            <button type="submit">Find</button>
            <button
              type="button"
              aria-label="Previous hit"
              disabled={highlights.length === 0}
              onClick={() => stepHit(-1)}
            >
              ‹
            </button>
            <button
              type="button"
              aria-label="Next hit"
              disabled={highlights.length === 0}
              onClick={() => stepHit(1)}
            >
              ›
            </button>
            {highlights.length > 0 && (
              <output>
                {activeHitIndex + 1} of {highlights.length}
              </output>
            )}
          </form>
          <select
            aria-label="Label names"
            value={labelDisplay}
            onChange={(event) =>
              setLabelDisplay(event.target.value as LabelDisplay)
            }
          >
            {LABEL_DISPLAYS.filter(
              // A DOCX has no hover mode.
              ({ value }) => isPdf || value !== "hover"
            ).map(({ value, name }) => (
              <option key={value} value={value}>
                {name}
              </option>
            ))}
          </select>
          {visiblePages && pageCount !== null && (
            <output className="pages">
              {pageRange(visiblePages, pageCount)}
            </output>
          )}
        </div>
        <div className="viewer">
          <DocumentAnnotator
            ref={handle}
            document={demo.document}
            annotations={annotations}
            relations={demo.relations}
            highlights={highlights}
            selectedRelationIds={
              selectedRelationId === null ? [] : [selectedRelationId]
            }
            showStructural={showStructural}
            labelDisplay={labelDisplay}
            visibleLabelIds={visibleLabelIds}
            annotationActions={annotationActions}
            {...controlled}
            renderSelectionMenu={(context) => (
              <SelectionMenu labels={demo.labels} {...context} />
            )}
            renderLoading={() => <p className="status">Loading document…</p>}
            renderError={(error) => (
              <p className="status">
                The document could not be shown: {error.message}
              </p>
            )}
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
            onAnnotationClick={(annotation) => {
              log("onAnnotationClick", annotation.id);
              // A PDF selects on a modifier-click; the demo also selects on a
              // plain one. A DOCX does that itself.
              if (isPdf) {
                handle.current?.selectAnnotations([annotation.id], {
                  scroll: false,
                });
              }
            }}
            onOpenLink={(url) => log("onOpenLink", url)}
            onVisiblePagesChange={setVisiblePages}
            onDocumentLoad={(info) => {
              setPageCount(info.pageCount);
              log(
                "onDocumentLoad",
                info.pageCount === null
                  ? `${info.text.length} characters`
                  : `${info.pageCount} pages`
              );
            }}
            onError={(error) => log("onError", error.message)}
          />
        </div>
        <section className="log" aria-label="Viewer callbacks">
          <h2>Viewer callbacks</h2>
          {events.length === 0 ? (
            <p>Each callback the viewer fires is listed here, newest first.</p>
          ) : (
            <ol>
              {events.map((event, index) => (
                // The list only ever shifts down by one; rows have no identity.
                <li key={events.length - index}>{event}</li>
              ))}
            </ol>
          )}
        </section>
      </section>
    </div>
  );
}
