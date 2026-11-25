/**
 * The DOCX document on screen: the last two stages of OpenContracts'
 * `DocxAnnotator` (`renderers/docx/DocxAnnotator.tsx`, 98286cabf) and its
 * interactions. The converted HTML (`loader.ts`) gets the visible span
 * annotations, the span highlights and the pending selection projected onto
 * it by docxodus (`projection.ts`), is laid out in pages by `docxodus/react`'s
 * `usePagination`, and is styled by its own stylesheet, scoped to this
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
 * `__pending__`) for the pending selection. The pagination also keeps an
 * invisible copy of the document in its staging element, which nothing here
 * looks at.
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
 * - Links in the document: a click on one never navigates the page the
 *   annotator is in. A link to elsewhere goes through the link policy
 *   (`useOpenLink`, source `"native"`); a link to a bookmark in the document
 *   scrolls the root to it. Either way the click is the link's, not an
 *   annotation's; the release of a text selection opens nothing.
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
 * Status: `ready` once the first projection of a document is laid out;
 * `error` when a pagination fails (what it left in the pages is removed).
 *
 * The host's controls: the annotation under the pointer and the selected
 * ones get a real label chip with the host's `annotationActions` buttons and
 * `renderAnnotationActions` content, over their CSS one (`ActionChips.tsx`).
 *
 * Removed from OpenContracts: the built-in selection menu and its portal,
 * `getSpan` and the CRUD callbacks, the read-only / label gates on selecting
 * (core applies `readOnly` when committing), the ref registry, the loading
 * and error messages, `generateAnnotationCss` (see `styles.ts`) and the
 * label filter (the shared visibility filter now runs before projection).
 *
 * Changed from OpenContracts: elements are looked for in the laid-out pages
 * only; the indentation docxodus adds to projected HTML is removed (see
 * `withoutIndentation`); nothing is projected while the button is down;
 * scrolling centres through `centreBox` and completes the scroll request
 * once landed, instead of `scrollIntoView` on every selection change; and
 * the document's links follow the link policy instead of navigating.
 */
import { AnnotationLabelMode, projectAnnotationsOntoHtml } from "docxodus";
import type { ExternalAnnotationProjectionSettings } from "docxodus";
import { usePagination } from "docxodus/react";
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
  useAnnotationActions,
  useCompleteSelection,
  useDisplaySettings,
  useHighlights,
  useNotifyDrawabilityChanged,
  useOnAnnotationClick,
  useOnAnnotationHover,
  useOpenLink,
  usePendingActions,
  usePendingSelection,
  useRenderAnnotationActions,
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
import { ActionChips } from "./ActionChips";
import {
  ACTION_CHIP_LINGER_MS,
  BOOKMARK_SCROLL_BEHAVIOR,
  CSS_CLASS_PREFIX,
  DOCUMENT_BACKGROUND,
  PAGE_GAP_PX,
} from "./constants";
import { pageClass } from "./isolation";
import type { DocxScope } from "./isolation";
import type { DocxDocument } from "./loader";
import { sanitizeProjectedHtml } from "./loader";
import {
  anchoredInHtml,
  buildProjection,
  entryKind,
  projectionSource,
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
 * The element the pages are laid out in: as tall as its pages, and never
 * scrolling itself (the annotator's root is the scroll container). Unlike
 * `docxodus/react`'s `PaginatedDocument`, it has no minimum height (that
 * one is at least as tall as the viewport).
 */
const PAGINATED_STYLE: CSSProperties = Object.freeze({
  backgroundColor: DOCUMENT_BACKGROUND,
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

/** The link at `target`, inside the pages. */
function linkAt(
  target: EventTarget | null,
  pages: HTMLElement | null
): HTMLAnchorElement | null {
  if (!pages || !(target instanceof Element)) return null;
  const link = target.closest<HTMLAnchorElement>("a[href]");
  return link && pages.contains(link) ? link : null;
}

/** The element of the pages with id `id`. */
function elementWithId(pages: HTMLElement, id: string): HTMLElement | null {
  return (
    Array.from(pages.querySelectorAll<HTMLElement>("[id]")).find(
      (element) => element.id === id
    ) ?? null
  );
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
  const openLink = useOpenLink();

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

  // What docxodus is given of the document, made once per document.
  const source = useMemo(
    () => (docx === null ? null : projectionSource(docx.html)),
    [docx]
  );

  /** Whether the primary button is down after a press in the document. */
  const [pressed, setPressed] = useState(false);
  const [projection, setProjection] = useState<Projection | null>(null);
  const projectionRef = useRef(projection);
  useLayoutEffect(() => {
    projectionRef.current = projection;
  });

  useEffect(() => {
    if (docx === null || source === null || pressed) return;
    // What is shown is already this projection: the release of a press,
    // which runs this again, projects nothing new.
    const current = projectionRef.current;
    if (
      current?.docx === docx &&
      current.key === projectionKey &&
      current.plan.set.content === text
    ) {
      return;
    }
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
    projectAnnotationsOntoHtml(
      source.markup,
      anchoredInHtml(plan.set, source.text),
      PROJECTION_SETTINGS
    )
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
  }, [docx, source, text, projectionKey, pressed]);

  // A projection of an earlier document is never shown.
  const shown = projection?.docx === docx ? projection : null;

  // ── Layout: the HTML last laid out in pages ──
  // `usePagination` writes the pages into this element itself (React renders
  // nothing in it), again whenever the HTML or the options change.
  const paginatedRef = useRef<HTMLDivElement>(null);
  const pagination = usePagination(shown?.html ?? "", paginatedRef, {
    scale: zoom,
    showPageNumbers: true,
    pageGap: PAGE_GAP_PX,
    cssPrefix: scope.pagePrefix,
    fragmentParagraphs: true,
  });
  const [laidOut, setLaidOut] = useState<Projection | null>(null);
  const shownRef = useRef(shown);
  useLayoutEffect(() => {
    shownRef.current = shown;
  });
  // Every pagination that succeeds is a new result.
  useEffect(() => {
    if (pagination.result) setLaidOut(shownRef.current);
  }, [pagination.result]);
  // A pagination that fails leaves what it wrote in the element; nothing of
  // it is shown, and the failure is the document's.
  useEffect(() => {
    if (!pagination.error) return;
    paginatedRef.current?.replaceChildren();
    setStatus({ state: "error", error: pagination.error });
  }, [pagination.error, setStatus]);
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
  /** Follows a link of the document, by the link policy or to a bookmark. */
  const follow = (link: HTMLAnchorElement, pages: HTMLElement) => {
    // As written: a relative URL is not resolved against the host's page.
    const href = link.getAttribute("href") ?? "";
    if (!href.startsWith("#")) {
      openLink(href, "native");
      return;
    }
    const bookmark = elementWithId(pages, href.slice(1));
    if (root && bookmark) {
      centreBox(root, bookmark, BOOKMARK_SCROLL_BEHAVIOR, () => {});
    }
  };

  const onClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    const pages = pagesOf();
    const link = linkAt(event.target, pages);
    // A link in the document never navigates the page it is shown in.
    if (link) event.preventDefault();
    // The release of a text selection, not a click.
    if (selectionIn(pages)) return;
    if (link && pages) {
      follow(link, pages);
      return;
    }
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

  // ── The host's controls (see `ActionChips.tsx`) ──
  const frameRef = useRef<HTMLDivElement>(null);
  const hasActions = useAnnotationActions().length > 0;
  const hasActionsSlot = useRenderAnnotationActions() !== undefined;
  const chipsShown = labelDisplay !== "hide" && (hasActions || hasActionsSlot);
  /** The annotation whose chip the pointer called up. */
  const [pointerId, setPointerId] = useState<string | null>(null);
  const linger = useRef<ReturnType<typeof setTimeout>>();
  const keepChip = () => clearTimeout(linger.current);
  // The pointer left the annotation, or its chip: on its way to the other,
  // perhaps.
  const releaseChip = () => {
    clearTimeout(linger.current);
    linger.current = setTimeout(
      () => setPointerId(null),
      ACTION_CHIP_LINGER_MS
    );
  };
  useEffect(() => () => clearTimeout(linger.current), []);
  const chipAnnotations = useMemo(() => {
    if (!chipsShown) return [];
    const ids = new Set(selectedIds);
    if (pointerId !== null) ids.add(pointerId);
    return [...ids].flatMap((id) => {
      const annotation = visible.find((candidate) => candidate.id === id);
      return annotation ? [annotation] : [];
    });
  }, [chipsShown, selectedIds, pointerId, visible]);
  const firstElementOf = useCallback(
    (id: string) => {
      const pages = containerRef.current?.querySelector<HTMLElement>(
        `.${pageClass(scope, "container")}`
      );
      return pages ? targetElement(pages, { kind: "annotation", id }) : null;
    },
    [scope]
  );

  // ── Hover ──
  const hovered = useRef<string | null>(null);
  const hover = (id: string | null) => {
    if (hovered.current === id) return;
    hovered.current = id;
    const annotation =
      id === null ? undefined : annotations.find((a) => a.id === id);
    reportHover(annotation?.source ?? null);
    if (!chipsShown) return;
    if (id === null) {
      releaseChip();
    } else {
      keepChip();
      setPointerId(id);
    }
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
    <div ref={frameRef} data-rca-docx-frame="" style={FRAME_STYLE}>
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
        {shown && <div ref={paginatedRef} style={PAGINATED_STYLE} />}
      </div>
      {chipAnnotations.length > 0 && (
        <ActionChips
          frame={frameRef}
          annotations={chipAnnotations}
          pointerId={pointerId}
          selectedIds={selectedIds}
          elementOf={firstElementOf}
          layout={pagination.result}
          onPointerEnter={keepChip}
          onPointerLeave={releaseChip}
        />
      )}
    </div>
  );
}
