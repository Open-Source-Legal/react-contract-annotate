/**
 * The DOCX document on screen: the last two stages of OpenContracts'
 * `DocxAnnotator` (`renderers/docx/DocxAnnotator.tsx`, 98286cabf) and its
 * interactions. The converted HTML (`loader.ts`) gets the visible span
 * annotations, the span highlights and the pending selection projected onto
 * it by docxodus (`projection.ts`), is laid out in pages by `docxodus/react`'s
 * `PaginatedDocument`, and is styled by docxodus' annotation CSS plus the
 * stylesheet of `styles.ts` (label colours and chips, selection, highlight
 * colours), which changes without projecting again.
 *
 * DOM contract: the element is `[data-rca-docx]`; inside its
 * `.page-container`, each projected part of an annotation or a highlight is
 * `[data-annotation-id="<id>"]` with `data-label-id` the annotation's label
 * id, or `__highlight__` / `__highlight_active__` for a highlight and
 * `__pending__` (id `__pending__`) for the pending selection.
 * `PaginatedDocument` also keeps an invisible copy of the document in a
 * `.page-staging` element, which nothing here looks at.
 *
 * Interactions:
 * - Text selection: a mouse-up with a non-empty native selection in the
 *   pages becomes a span draft (`{ start, end }` into `text`, found by
 *   searching `text` for the selected text and, when it occurs more than
 *   once, taking the occurrence nearest the selection's DOM offset) completed
 *   through core with its anchor at the bottom centre of the selection. A
 *   mouse-down starts a new selection, so it clears the pending one; until
 *   the button is released (anywhere) nothing is projected again, because a
 *   new layout would replace the text being selected.
 * - Clicks (not ending a text selection): a plain click on an annotation
 *   selects only it, Ctrl/Cmd-click toggles it, a click elsewhere clears the
 *   selection, all as user changes; every click on an annotation goes to
 *   `onAnnotationClick`. Highlights and the pending selection are not
 *   clicked: a click on them is a click elsewhere.
 * - Hover goes to `onAnnotationHover`.
 * - Scroll requests: once the document is laid out, the target's first
 *   element is centred in the root (`centreBox`) and the request completed
 *   when the scroll has landed; a target not laid out yet is looked for
 *   again after each new layout.
 *
 * Status: `ready` once the first projection of a document is laid out.
 *
 * Removed from OpenContracts: the built-in selection menu and its portal,
 * `getSpan` and the CRUD callbacks, the read-only / label gates on selecting
 * (core applies `readOnly` when committing), the ref registry, the loading
 * and error messages, and the label filter (the shared visibility filter now
 * runs before projection).
 *
 * Changed from OpenContracts: offsets and elements are looked for in the
 * laid-out pages only (counting `PaginatedDocument`'s staging copy, as
 * OpenContracts did, shifted every DOM offset by the whole document, so
 * repeated text always resolved to its last occurrence); repeated text is
 * told apart by the selection's start rather than its anchor (the end, for
 * a backward drag); a whitespace-insensitive match that cannot be mapped
 * back to `text` selects nothing instead of offsets into the normalised
 * text; the indentation docxodus adds to projected HTML is removed (see
 * `withoutIndentation`); nothing is projected while the button is down; and
 * scrolling centres through `centreBox` and completes the scroll request
 * once landed, instead of `scrollIntoView` on every selection change.
 */
import {
  AnnotationLabelMode,
  findTextOccurrences,
  generateAnnotationCss,
  projectAnnotationsOntoHtml,
} from "docxodus";
import type {
  AnnotationLabel as DocxodusLabel,
  ExternalAnnotationProjectionSettings,
} from "docxodus";
import { PaginatedDocument } from "docxodus/react";
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { CSSProperties, MouseEvent as ReactMouseEvent } from "react";

import {
  centreBox,
  useActiveHighlightId,
  useAllAnnotations,
  useCompleteSelection,
  useDisplaySettings,
  useHighlights,
  useOnAnnotationClick,
  useOnAnnotationHover,
  usePendingActions,
  usePendingSelection,
  useRootElement,
  useScrollRequest,
  useSelectedAnnotationIds,
  useSetControllable,
  useSetDocumentStatus,
  useVisibleAnnotations,
  useZoom,
} from "../core/index";
import type {
  AnnotationDraft,
  AnnotationLabel,
  ChangeInfo,
  InternalAnnotation,
  ScrollTarget,
  SpanAnnotationJson,
} from "../core/index";
import {
  ACTIVE_HIGHLIGHT_LABEL_ID,
  ANNOTATION_LABEL_CLASS,
  CSS_CLASS_PREFIX,
  DOCUMENT_BACKGROUND,
  HIGHLIGHT_LABEL_ID,
  PAGE_CONTAINER_CLASS,
  PAGE_GAP_PX,
  PENDING_COLOR,
  PENDING_LABEL_ID,
} from "./constants";
import {
  getGlobalOffsetFromDomPosition,
  pickClosestOccurrence,
} from "./docxOffsetUtils";
import type { DocxDocument } from "./loader";
import { sanitizeDocxHtml } from "./loader";
import {
  annotationLabelRecord,
  buildProjectionSet,
  withoutIndentation,
} from "./projection";
import { buildDocxCss } from "./styles";

const USER: ChangeInfo = Object.freeze({ source: "user" });

/** Stable projection settings shared by projection and CSS generation. */
const PROJECTION_SETTINGS: ExternalAnnotationProjectionSettings = Object.freeze(
  {
    cssClassPrefix: CSS_CLASS_PREFIX,
    labelMode: AnnotationLabelMode.None,
    includeMetadata: true,
    // Both backend (Docxodus microservice) and frontend (Docxodus WASM) use the same
    // library, so offsets should align. Validation is kept enabled as a safety net in
    // case the two sides drift to different versions.
    validateBeforeProjection: true,
  }
);

/**
 * The paginated view grows with its pages and never scrolls itself: the
 * annotator's root is the scroll container.
 */
const PAGINATED_STYLE: CSSProperties = Object.freeze({
  maxWidth: "100%",
  overflow: "visible",
});

/** What a projected element stands for. */
type Projected = { kind: "annotation" | "highlight" | "pending"; id: string };

function projectedKind(labelId: string | null): Projected["kind"] {
  if (labelId === HIGHLIGHT_LABEL_ID || labelId === ACTIVE_HIGHLIGHT_LABEL_ID) {
    return "highlight";
  }
  return labelId === PENDING_LABEL_ID ? "pending" : "annotation";
}

function describe(element: Element): Projected | null {
  const id = element.getAttribute("data-annotation-id");
  if (id === null) return null;
  return { kind: projectedKind(element.getAttribute("data-label-id")), id };
}

/** The laid-out pages (not `PaginatedDocument`'s invisible staging copy). */
function pagesOf(container: HTMLElement | null): HTMLElement | null {
  return (
    container?.querySelector<HTMLElement>(`.${PAGE_CONTAINER_CLASS}`) ?? null
  );
}

/** The innermost projected element at `target`, inside the pages. */
function projectedAt(
  target: EventTarget | null,
  pages: HTMLElement | null
): Projected | null {
  if (!pages || !(target instanceof Element) || !pages.contains(target)) {
    return null;
  }
  const element = target.closest("[data-annotation-id]");
  return element && pages.contains(element) ? describe(element) : null;
}

/** The first laid-out element of a scroll target. */
function targetElement(
  pages: HTMLElement,
  target: ScrollTarget
): HTMLElement | null {
  for (const element of Array.from(
    pages.querySelectorAll<HTMLElement>("[data-annotation-id]")
  )) {
    const projected = describe(element);
    if (projected?.id === target.id && projected.kind === target.kind) {
      return element;
    }
  }
  return null;
}

/** The pending selection's offsets, when it is a span. */
function pendingSpan(json: AnnotationDraft["json"] | undefined) {
  const span = json as Partial<SpanAnnotationJson> | undefined;
  return typeof span?.start === "number" && typeof span.end === "number"
    ? { start: span.start, end: span.end }
    : null;
}

/** The native selection, when it selects text and starts in `pages`. */
function selectionIn(pages: HTMLElement | null): Selection | null {
  const selection = pages?.ownerDocument.getSelection() ?? null;
  return pages &&
    selection &&
    !selection.isCollapsed &&
    selection.rangeCount > 0 &&
    selection.toString().trim() !== "" &&
    pages.contains(selection.anchorNode)
    ? selection
    : null;
}

/**
 * The offsets in `text` of the text selected in `pages`, found by searching
 * for it (`findTextOccurrences`, then whitespace-insensitively) and, for
 * repeated text, taking the occurrence nearest the selection's start in the
 * DOM. Null when the text is not found.
 */
function selectedSpan(
  text: string,
  selection: Selection,
  pages: HTMLElement
): SpanAnnotationJson | null {
  // Get the raw selected text. For cross-page selections this may
  // include page number artifacts (e.g. "...text\n1\nmore text...").
  // Clean it by removing isolated numbers on their own lines
  // (PaginatedDocument page numbers).
  const rawText = selection.toString();
  const cleanedText = rawText
    .replace(/\n\d+\n/g, "\n") // Remove "1", "2" etc. between newlines
    .trim();

  if (!cleanedText) return null;

  // Search for the cleaned text in docText
  let occurrences = findTextOccurrences(text, cleanedText);

  // If no exact match (common for cross-page selections with whitespace
  // differences), try collapsing whitespace for a fuzzy match
  if (occurrences.length === 0) {
    const normalized = cleanedText.replace(/\s+/g, " ");
    occurrences = findTextOccurrences(text.replace(/\s+/g, " "), normalized);
    // Map back to original docText offsets by searching from the
    // normalized match position
    if (occurrences.length > 0) {
      const approxStart = occurrences[0].start;
      // Find the actual position in docText near this offset
      const searchWindow = text.substring(
        Math.max(0, approxStart - 50),
        approxStart + cleanedText.length + 50
      );
      const firstWords = cleanedText.substring(0, 30);
      const idx = searchWindow.indexOf(firstWords);
      occurrences = [];
      if (idx >= 0) {
        const realStart = Math.max(0, approxStart - 50) + idx;
        // Find the end by matching the last few words
        const lastWords = cleanedText.substring(cleanedText.length - 30);
        const endSearch = text.indexOf(
          lastWords,
          realStart + cleanedText.length - 60
        );
        if (endSearch >= 0) {
          occurrences = [
            { start: realStart, end: endSearch + lastWords.length },
          ];
        }
      }
    }
  }

  if (occurrences.length === 0) return null;

  // Disambiguate if multiple matches using DOM position
  if (occurrences.length === 1) return occurrences[0];
  const range = selection.getRangeAt(0);
  const startOffset = getGlobalOffsetFromDomPosition(
    pages,
    range.startContainer,
    range.startOffset,
    ANNOTATION_LABEL_CLASS
  );
  return startOffset === null
    ? occurrences[0]
    : pickClosestOccurrence(occurrences, startOffset);
}

/** Every label of the span annotations, once each, in first-seen order. */
function uniqueLabels(
  annotations: readonly InternalAnnotation[]
): AnnotationLabel[] {
  const byId = new Map<string, AnnotationLabel>();
  for (const annotation of annotations) {
    if (annotation.kind !== "span") continue;
    const label = annotation.annotationLabel;
    if (!byId.has(label.id)) byId.set(label.id, label);
  }
  return [...byId.values()];
}

/**
 * The label record docxodus generates its annotation CSS from: every label,
 * and the synthetic ones, so the base highlight rule is always there.
 */
function cssLabelRecord(
  labels: readonly AnnotationLabel[]
): Record<string, DocxodusLabel> {
  const record: Record<string, DocxodusLabel> = {};
  for (const label of labels) record[label.id] = annotationLabelRecord(label);
  for (const id of [HIGHLIGHT_LABEL_ID, ACTIVE_HIGHLIGHT_LABEL_ID]) {
    record[id] ??= annotationLabelRecord({ id, text: "" });
  }
  record[PENDING_LABEL_ID] ??= annotationLabelRecord({
    id: PENDING_LABEL_ID,
    text: "",
    color: PENDING_COLOR,
  });
  return record;
}

/** One projection of one document. */
type Projection = { docx: DocxDocument; html: string };

export interface DocxViewProps {
  /** The current document; null while it loads. */
  docx: DocxDocument | null;
  /** The text the offsets index into. */
  text: string;
}

export function DocxView({ docx, text }: DocxViewProps) {
  const scope = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const root = useRootElement();
  const zoom = useZoom();
  const setStatus = useSetDocumentStatus();
  const visible = useVisibleAnnotations();
  const annotations = useAllAnnotations();
  const highlights = useHighlights();
  const activeHighlightId = useActiveHighlightId();
  const pending = usePendingSelection();
  const pendingActions = usePendingActions();
  const completeSelection = useCompleteSelection();
  const selectedIds = useSelectedAnnotationIds();
  const setSelection = useSetControllable<string[]>("selection");
  const { labelDisplay } = useDisplaySettings();
  const reportClick = useOnAnnotationClick();
  const reportHover = useOnAnnotationHover();

  // ── Stage 3: project annotations, highlights and the pending selection ──
  // Keyed on the text and the content of the entries, so new arrays (a
  // selection change re-filters the visible annotations) project nothing
  // again.
  const pendingOffsets = pendingSpan(pending?.json);
  const pendingStart = pendingOffsets?.start;
  const pendingEnd = pendingOffsets?.end;
  const projectionSet = useMemo(
    () =>
      buildProjectionSet({
        text,
        annotations: visible,
        highlights,
        activeHighlightId,
        pending:
          pendingStart === undefined || pendingEnd === undefined
            ? null
            : { start: pendingStart, end: pendingEnd },
      }),
    [text, visible, highlights, activeHighlightId, pendingStart, pendingEnd]
  );
  const projectionKey = useMemo(
    () =>
      JSON.stringify([projectionSet.labelledText, projectionSet.textLabels]),
    [projectionSet]
  );
  const latestSet = useRef(projectionSet);
  useLayoutEffect(() => {
    latestSet.current = projectionSet;
  });

  /** Whether the primary button is down after a press in the document. */
  const [pressed, setPressed] = useState(false);
  const [projection, setProjection] = useState<Projection | null>(null);

  useEffect(() => {
    if (docx === null || pressed) return;
    let cancelled = false;
    const show = (html: string) =>
      setProjection((prev) =>
        prev?.docx === docx && prev.html === html ? prev : { docx, html }
      );
    const set = latestSet.current;
    if (set.labelledText.length === 0) {
      show(docx.html);
      return;
    }
    projectAnnotationsOntoHtml(docx.html, set, PROJECTION_SETTINGS)
      .then((html) => {
        if (!cancelled) show(sanitizeDocxHtml(withoutIndentation(html)));
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        console.error("Annotation projection error:", error);
        show(docx.html);
      });
    return () => {
      cancelled = true;
    };
  }, [docx, text, projectionKey, pressed]);

  // A projection of an earlier document is never shown.
  const shown = projection?.docx === docx ? projection : null;

  // ── Layout: the projection last laid out by PaginatedDocument ──
  const [laidOut, setLaidOut] = useState<Projection | null>(null);
  const shownRef = useRef(shown);
  useLayoutEffect(() => {
    shownRef.current = shown;
  });
  // Stable: PaginatedDocument reports again whenever this function changes.
  const onPaginationComplete = useCallback(() => {
    setLaidOut(shownRef.current);
  }, []);
  const rendered = shown !== null && laidOut === shown;

  useEffect(() => {
    if (rendered) setStatus({ state: "ready" });
  }, [rendered, setStatus]);

  // ── Stage 4: CSS ──
  const labels = useMemo(() => uniqueLabels(annotations), [annotations]);
  const labelRecord = useMemo(() => cssLabelRecord(labels), [labels]);
  const labelKey = useMemo(() => JSON.stringify(labelRecord), [labelRecord]);
  const [annotationCss, setAnnotationCss] = useState("");
  const wasmReady = docx !== null;
  const latestLabels = useRef(labelRecord);
  useLayoutEffect(() => {
    latestLabels.current = labelRecord;
  });
  useEffect(() => {
    if (!wasmReady) return;
    let cancelled = false;
    generateAnnotationCss(latestLabels.current, PROJECTION_SETTINGS)
      .then((css) => {
        if (!cancelled) setAnnotationCss(css);
      })
      .catch((error: unknown) => {
        if (!cancelled)
          console.error("Annotation CSS generation error:", error);
      });
    return () => {
      cancelled = true;
    };
  }, [wasmReady, labelKey]);

  const customCss = useMemo(
    () =>
      buildDocxCss({ scope, labels, selectedIds, highlights, labelDisplay }),
    [scope, labels, selectedIds, highlights, labelDisplay]
  );

  // ── Scroll requests ──
  const { request, complete } = useScrollRequest();
  useEffect(() => {
    const pages = pagesOf(containerRef.current);
    if (!request || !root || !rendered || !pages) return;
    const element = targetElement(pages, request.target);
    // Not laid out (yet): a later layout runs this again.
    if (!element) return;
    const { seq } = request;
    return centreBox(root, element, request.behavior, () =>
      complete(seq, true)
    );
  }, [request, root, rendered, laidOut, complete]);

  // ── Text selection ──
  useEffect(() => {
    if (!pressed) return;
    // Released anywhere, inside the annotator or out of it, or the press
    // became a drag of the selected text (which ends without a mouse-up).
    const release = () => setPressed(false);
    window.addEventListener("mouseup", release);
    window.addEventListener("dragend", release);
    return () => {
      window.removeEventListener("mouseup", release);
      window.removeEventListener("dragend", release);
    };
  }, [pressed]);

  const onMouseDown = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    setPressed(true);
    pendingActions.clear();
  };

  const onMouseUp = () => {
    const pages = pagesOf(containerRef.current);
    const selection = selectionIn(pages);
    if (!pages || !selection) return;
    const span = selectedSpan(text, selection, pages);
    if (!span) return;
    const rect = selection.getRangeAt(0).getBoundingClientRect();
    completeSelection(
      {
        json: span,
        rawText: text.slice(span.start, span.end),
        page: 0,
        annotationLabel: null,
      },
      { x: rect.left + rect.width / 2, y: rect.bottom }
    );
  };

  // ── Clicks ──
  const onClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    const pages = pagesOf(containerRef.current);
    // The release of a text selection, not a click.
    if (selectionIn(pages)) return;
    const hit = projectedAt(event.target, pages);
    const annotation =
      hit?.kind === "annotation"
        ? annotations.find((candidate) => candidate.id === hit.id)
        : undefined;
    if (!annotation) {
      if (selectedIds.length > 0) setSelection([], USER);
      return;
    }
    const selected = selectedIds.includes(annotation.id);
    const next =
      event.ctrlKey || event.metaKey
        ? selected
          ? selectedIds.filter((id) => id !== annotation.id)
          : [...selectedIds, annotation.id]
        : [annotation.id];
    const unchanged =
      next.length === selectedIds.length &&
      next.every((id, index) => id === selectedIds[index]);
    if (!unchanged) setSelection(next, USER);
    reportClick(annotation.source, event);
  };

  // ── Hover ──
  const hovered = useRef<string | null>(null);
  const hover = (id: string | null) => {
    if (hovered.current === id) return;
    hovered.current = id;
    const annotation =
      id === null ? undefined : annotations.find((a) => a.id === id);
    reportHover(annotation?.source ?? null);
  };
  // The document leaving under the pointer gets no mouseleave.
  useEffect(
    () => () => {
      if (hovered.current !== null) reportHover(null);
    },
    [reportHover]
  );
  const onMouseOver = (event: ReactMouseEvent<HTMLDivElement>) => {
    const hit = projectedAt(event.target, pagesOf(containerRef.current));
    hover(hit?.kind === "annotation" ? hit.id : null);
  };

  return (
    <div
      ref={containerRef}
      data-rca-docx={scope}
      style={{ fontSize: `${zoom}em` }}
      onMouseDown={onMouseDown}
      onMouseUp={onMouseUp}
      onClick={onClick}
      onMouseOver={onMouseOver}
      onMouseLeave={() => hover(null)}
    >
      <style>{annotationCss}</style>
      <style>{customCss}</style>
      {shown && (
        <PaginatedDocument
          html={shown.html}
          scale={zoom}
          showPageNumbers={true}
          pageGap={PAGE_GAP_PX}
          backgroundColor={DOCUMENT_BACKGROUND}
          style={PAGINATED_STYLE}
          onPaginationComplete={onPaginationComplete}
        />
      )}
    </div>
  );
}
