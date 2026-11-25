/**
 * The DOCX document on screen: the last two stages of OpenContracts'
 * `DocxAnnotator` (`renderers/docx/DocxAnnotator.tsx`, 98286cabf) and its
 * interactions. The converted HTML (`loader.ts`) gets the visible span
 * annotations, the span highlights and the pending selection projected onto
 * it by docxodus (`projection.ts`), is laid out in pages by `docxodus/react`'s
 * `PaginatedDocument`, and is styled by its own stylesheet, scoped to this
 * annotator (`isolation.ts`), plus the stylesheet of `styles.ts` (label
 * colours and chips, selection, highlight colours), which changes without
 * projecting again.
 *
 * Containment: the document is shown inside a frame of the library's own
 * (`[data-rca-docx-frame]`), around the scope element. The document's
 * stylesheet is scoped to the scope element and what is inside it, so it
 * cannot select the frame; the frame contains layout, paint and style and
 * isolates stacking, so nothing the document styles (a scope element raised
 * above everything, an element positioned far away) is positioned, painted
 * or hit outside the frame or above the host's content, and the counters
 * its elements increment are its own. For positions and named counters this
 * is defence in depth: the allow-list of `cssAllowList.ts` keeps `position:
 * fixed` and `counter-*` out of the document's CSS already. For list items
 * it is the only barrier: `display: list-item` is kept, and without style
 * containment the document's list items would renumber a list of the host's
 * the annotator stands in. The frame is as wide as its content or the root,
 * whichever is wider, so a zoomed page still scrolls.
 *
 * DOM contract: the element is `[data-rca-docx="<scope id>"]`; inside its
 * page container (class `rca-<scope id>-page-container`), each projected
 * part of an annotation or a highlight is `[data-annotation-id="<id>"]`
 * with `data-label-id` the annotation's label id, or `__highlight__` /
 * `__highlight_active__` for a highlight and `__pending__` (id
 * `__pending__`) for the pending selection. `PaginatedDocument` also keeps
 * an invisible copy of the document in its staging element, which nothing
 * here looks at.
 *
 * Interactions:
 * - Text selection: a mouse-up with a non-empty native selection in the
 *   pages becomes a span draft (`textSelection.ts`) completed through core
 *   with its anchor at the bottom centre of the selection. A mouse-down
 *   starts a new selection, so it clears the pending one; until the button
 *   is released (anywhere) nothing is projected again, because a new layout
 *   would replace the text being selected.
 * - Clicks (not ending a text selection): a plain click on an annotation
 *   selects only it, Ctrl/Cmd-click toggles it, a click elsewhere clears the
 *   selection, all as user changes; every click on an annotation goes to
 *   `onAnnotationClick`. Highlights and the pending selection are not
 *   clicked: a click on them is a click elsewhere.
 * - Hover goes to `onAnnotationHover`.
 * - Scroll requests: once the document is laid out, the target's first
 *   element is centred in the root (`centreBox`) and the request completed
 *   when the scroll has landed; a target not laid out yet is looked for
 *   again after each new layout, and one the up-to-date projection did not
 *   draw (docxodus draws one of two overlapping spans) completes `false`.
 *
 * After each layout the annotations and highlights the projection was asked
 * to draw but did not are written to `suppressedRef` (the driver's
 * `canDraw` reads it) and the shell is told drawability may have changed.
 *
 * Status: `ready` once the first projection of a document is laid out.
 *
 * Removed from OpenContracts: the built-in selection menu and its portal,
 * `getSpan` and the CRUD callbacks, the read-only / label gates on selecting
 * (core applies `readOnly` when committing), the ref registry, the loading
 * and error messages, `generateAnnotationCss` (see `styles.ts`) and the
 * label filter (the shared visibility filter now runs before projection).
 *
 * Changed from OpenContracts: elements are looked for in the laid-out pages
 * only; the indentation docxodus adds to projected HTML is removed (see
 * `withoutIndentation`); nothing is projected while the button is down; and
 * scrolling centres through `centreBox` and completes the scroll request
 * once landed, instead of `scrollIntoView` on every selection change.
 */
import { AnnotationLabelMode, projectAnnotationsOntoHtml } from "docxodus";
import type { ExternalAnnotationProjectionSettings } from "docxodus";
import { PaginatedDocument } from "docxodus/react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  CSSProperties,
  MouseEvent as ReactMouseEvent,
  MutableRefObject,
} from "react";

import {
  centreBox,
  useActiveHighlightId,
  useAllAnnotations,
  useCompleteSelection,
  useDisplaySettings,
  useHighlights,
  useNotifyDrawabilityChanged,
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
  CSS_CLASS_PREFIX,
  DOCUMENT_BACKGROUND,
  PAGE_GAP_PX,
} from "./constants";
import { pageClass } from "./isolation";
import type { DocxScope } from "./isolation";
import type { DocxDocument } from "./loader";
import { sanitizeProjectedHtml } from "./loader";
import {
  buildProjection,
  entryKind,
  suppressedTargets,
  withoutIndentation,
} from "./projection";
import type {
  EntryKind,
  Projection as ProjectionPlan,
  TargetIds,
} from "./projection";
import { buildDocxCss } from "./styles";
import { selectedSpan, selectionIn } from "./textSelection";

const USER: ChangeInfo = Object.freeze({ source: "user" });

/** Stable projection settings. */
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
 * The frame around the scope element (see the module comment): a containing
 * block for fixed and absolute descendants, a paint clip, a scope for
 * counters and a stacking context, as wide as its content or the root.
 */
const FRAME_STYLE: CSSProperties = Object.freeze({
  contain: "layout paint style",
  isolation: "isolate",
  width: "max-content",
  minWidth: "100%",
});

/**
 * The paginated view grows with its pages and never scrolls itself: the
 * annotator's root is the scroll container.
 */
const PAGINATED_STYLE: CSSProperties = Object.freeze({
  maxWidth: "100%",
  overflow: "visible",
});

/** What a projected element stands for. */
type Projected = { kind: EntryKind; id: string; labelId: string | null };

function describe(element: Element): Projected | null {
  const id = element.getAttribute("data-annotation-id");
  if (id === null) return null;
  const labelId = element.getAttribute("data-label-id");
  return { kind: entryKind(labelId), id, labelId };
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

/** Every projected element in the pages. */
function projectedElements(pages: HTMLElement): HTMLElement[] {
  return Array.from(
    pages.querySelectorAll<HTMLElement>("[data-annotation-id]")
  );
}

/** The first laid-out element of a scroll target. */
function targetElement(
  pages: HTMLElement,
  target: ScrollTarget
): HTMLElement | null {
  return (
    projectedElements(pages).find((element) => {
      const projected = describe(element);
      return projected?.id === target.id && projected.kind === target.kind;
    }) ?? null
  );
}

/** The pending selection's offsets, when it is a span. */
function pendingSpan(json: AnnotationDraft["json"] | undefined) {
  const span = json as Partial<SpanAnnotationJson> | undefined;
  return typeof span?.start === "number" && typeof span.end === "number"
    ? { start: span.start, end: span.end }
    : null;
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

/** One projection of one document, and what it was made from. */
type Projection = {
  docx: DocxDocument;
  html: string;
  plan: ProjectionPlan;
  key: string;
};

export interface DocxViewProps {
  /** The current document; null while it loads. */
  docx: DocxDocument | null;
  /** The text the offsets index into. */
  text: string;
  /** The annotator's scope (see `isolation.ts`). */
  scope: DocxScope;
  /**
   * Written after each layout: what the projection was asked to draw but
   * did not.
   */
  suppressedRef: MutableRefObject<TargetIds | null>;
}

export function DocxView({ docx, text, scope, suppressedRef }: DocxViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const root = useRootElement();
  const zoom = useZoom();
  const setStatus = useSetDocumentStatus();
  const notifyDrawabilityChanged = useNotifyDrawabilityChanged();
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

  const containerClass = pageClass(scope, "container");
  const pagesOf = (): HTMLElement | null =>
    containerRef.current?.querySelector<HTMLElement>(`.${containerClass}`) ??
    null;

  // ── Stage 3: project annotations, highlights and the pending selection ──
  // Keyed on the text and the content of the entries, so new arrays (a
  // selection change re-filters the visible annotations) project nothing
  // again.
  const pendingOffsets = pendingSpan(pending?.json);
  const pendingStart = pendingOffsets?.start;
  const pendingEnd = pendingOffsets?.end;
  const projectionPlan = useMemo(
    () =>
      buildProjection({
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
      JSON.stringify([
        projectionPlan.set.labelledText,
        projectionPlan.set.textLabels,
        [...projectionPlan.gaveWay],
      ]),
    [projectionPlan]
  );
  const latestPlan = useRef(projectionPlan);
  useLayoutEffect(() => {
    latestPlan.current = projectionPlan;
  });

  /** Whether the primary button is down after a press in the document. */
  const [pressed, setPressed] = useState(false);
  const [projection, setProjection] = useState<Projection | null>(null);

  useEffect(() => {
    if (docx === null || pressed) return;
    let cancelled = false;
    const plan = latestPlan.current;
    const key = projectionKey;
    const show = (html: string) =>
      setProjection((prev) =>
        prev?.docx === docx && prev.html === html && prev.key === key
          ? prev
          : { docx, html, plan, key }
      );
    if (plan.set.labelledText.length === 0) {
      show(docx.html);
      return;
    }
    projectAnnotationsOntoHtml(docx.html, plan.set, PROJECTION_SETTINGS)
      .then((html) => {
        if (!cancelled) show(sanitizeProjectedHtml(withoutIndentation(html)));
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

  // ── Layout: the HTML PaginatedDocument last laid out ──
  const [laidOut, setLaidOut] = useState<Projection | null>(null);
  const shownRef = useRef(shown);
  useLayoutEffect(() => {
    shownRef.current = shown;
  });
  // Stable: PaginatedDocument reports again whenever this function changes.
  const onPaginationComplete = useCallback(() => {
    setLaidOut(shownRef.current);
  }, []);
  // A new projection with the same HTML needs no new layout.
  const rendered =
    shown !== null &&
    laidOut !== null &&
    laidOut.docx === shown.docx &&
    laidOut.html === shown.html;
  // Laid out, and no newer projection on its way.
  const settled = rendered && shown.key === projectionKey;

  // What the shown projection did not draw, for `canDraw`; written before
  // any passive effect (the shell's included) can ask.
  useLayoutEffect(() => {
    const pages = pagesOf();
    if (!rendered || !pages) return;
    suppressedRef.current = suppressedTargets(
      shown.plan,
      projectedElements(pages).map((element) => ({
        id: element.getAttribute("data-annotation-id") ?? "",
        labelId: element.getAttribute("data-label-id"),
      }))
    );
    notifyDrawabilityChanged();
  }, [rendered, shown, laidOut, suppressedRef, notifyDrawabilityChanged]);

  useEffect(() => {
    if (rendered) setStatus({ state: "ready" });
  }, [rendered, setStatus]);

  // ── Stage 4: CSS ──
  const labels = useMemo(() => uniqueLabels(annotations), [annotations]);
  const customCss = useMemo(
    () =>
      buildDocxCss({ scope, labels, selectedIds, highlights, labelDisplay }),
    [scope, labels, selectedIds, highlights, labelDisplay]
  );

  // ── Scroll requests ──
  const { request, complete } = useScrollRequest();
  useEffect(() => {
    const pages = pagesOf();
    if (!request || !root || !rendered || !pages) return;
    const { seq, target } = request;
    const element = targetElement(pages, target);
    if (!element) {
      // Not laid out yet: a later layout runs this again. Not drawn by the
      // up-to-date projection: it never will be.
      if (settled && suppressedRef.current?.[target.kind].has(target.id)) {
        complete(seq, false);
      }
      return;
    }
    return centreBox(root, element, request.behavior, () =>
      complete(seq, true)
    );
  }, [request, root, rendered, settled, laidOut, complete, suppressedRef]);

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
    const pages = pagesOf();
    const selection = selectionIn(pages);
    if (!pages || !selection) return;
    const span = selectedSpan(
      text,
      selection,
      pages,
      pageClass(scope, "number")
    );
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
    const pages = pagesOf();
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
    const hit = projectedAt(event.target, pagesOf());
    hover(hit?.kind === "annotation" ? hit.id : null);
  };

  return (
    <div data-rca-docx-frame="" style={FRAME_STYLE}>
      <div
        ref={containerRef}
        data-rca-docx={scope.id}
        style={{ fontSize: `${zoom}em` }}
        onMouseDown={onMouseDown}
        onMouseUp={onMouseUp}
        onClick={onClick}
        onMouseOver={onMouseOver}
        onMouseLeave={() => hover(null)}
      >
        {docx && <style>{docx.css}</style>}
        <style>{customCss}</style>
        {shown && (
          <PaginatedDocument
            html={shown.html}
            scale={zoom}
            showPageNumbers={true}
            pageGap={PAGE_GAP_PX}
            backgroundColor={DOCUMENT_BACKGROUND}
            cssPrefix={scope.pagePrefix}
            style={PAGINATED_STYLE}
            onPaginationComplete={onPaginationComplete}
          />
        )}
      </div>
    </div>
  );
}
