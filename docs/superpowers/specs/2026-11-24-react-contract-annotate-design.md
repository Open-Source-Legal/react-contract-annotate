# react-contract-annotate — design

Date: 2026-11-24
Status: draft for approval

## Intent

Lift the document viewer/annotator out of OpenContracts
(`frontend/src/components/annotator/` in `Open-Source-Legal/OpenContracts`)
into a standalone React library, `Open-Source-Legal/react-contract-annotate`.

The library renders a document with OpenContracts annotations on top and
exposes an API to drive it. It ships **no controls**: no toolbar, zoom
buttons, label picker, sidebar, action menus or modals. A host application
supplies its own UI and talks to the viewer through props, callbacks, render
slots and a ref handle.

It supports **PDF and DOCX** at launch and is structured so further formats
(plain text first) can be added without changing the public contract.

Every piece of interactive state (selection, zoom, active highlight) works
either **controlled** by the host or **managed internally**.

## Goals

1. Display OpenContracts annotations on PDF (token/PAWLs based) and DOCX
   (character-offset based) with the same geometry OpenContracts produces for
   the same data.
2. Jump to an annotation, highlight or page on demand, including on pages that
   are not currently mounted (PDF pages are virtualized).
3. Let a user create annotations by selecting text; the library reports the
   selection and never persists anything itself.
4. Controlled and uncontrolled operation for selection, zoom and active
   highlight.
5. Several viewers on one page without interfering with each other.
6. A PDF-only host never installs or downloads the DOCX engine, and vice versa.
7. A documented contract for adding a format.

## Non-goals (this version)

- Migrating OpenContracts to consume the library. OpenContracts is not touched.
  (Expected follow-up; the API should not make it impossible.)
- Any built-in toolbar, label picker, sidebar, modal or menu.
- Zoom gestures (Ctrl+wheel, pinch, keyboard). In OpenContracts these live
  outside the annotator (`document_kb/useZoomManager.ts`) on document-level
  listeners. The host drives zoom through props or the handle.
- Plain-text / markdown renderers. The span model is shared with DOCX so TXT
  is the expected next format, but it is not built now.
- Fetching annotations, GraphQL, auth, permissions, persistence, undo.
- Creating or editing relationships. (Displaying them is in; see below.)
- Free-form box annotations that are not snapped to tokens.
- Synthesising tokens from the pdf.js text layer when no PAWLs data is given.
- Publishing to npm. The package is built publishable but not published until
  asked.

## Anti-goals

- State that leaks between instances or into the host (module-level mutable
  state, default Jotai store, `document.querySelector` across the page).
- Dragging Apollo, react-router, semantic-ui, `@os-legal/ui` or lodash into
  the bundle.
- Geometry drift: an annotation must land on the same pixels as it does in
  OpenContracts at the same zoom.
- A "rewrite for cleanliness" of the virtualization, zoom-render coordination
  or two-phase scroll *mechanics*. Those are moved, not redesigned. (What
  *triggers* a scroll does change; see "Scroll requests".)

## Constraints

- Source of truth for the port is OpenContracts **`origin/main` at
  `98286cabf`** (2026-11-20). Port from a checkout of that commit, not from a
  feature branch: older branches are still on the pdf.js 4 API.
  Key files: `renderers/pdf/{PDF,PDFPage,SelectionLayer,NativeLinkLayer}.tsx`,
  `display/components/*`, `types/{pdf,annotations}.ts`,
  `renderers/docx/{DocxAnnotator.tsx,docxOffsetUtils.ts}`,
  `hooks/useVisibleAnnotations.ts`, `context/*Atom*.tsx`, and from
  `frontend/src/utils/`: `transform.tsx` (bounds maths, `resolvePageTokens`,
  `normalizeTokensToPdfViewport`), `compactAnnotationJson.ts`, `colorUtils`,
  `pdfZoom.ts`, `layout.ts`, plus `annotator/utils.ts`
  (`createTokenStringSearch`, `convertAnnotationTokensToText`).
- React 18+. styled-components 6 (already used by the ported code).
- pdf.js: OpenContracts `main` runs `pdfjs-dist` ^6.5.438 and imports the
  runtime from `pdfjs-dist/legacy/build/pdf.mjs`; the ported code uses
  6-only calls (`page.render({ canvas, viewport })`,
  `convertToViewportPoint`). The library targets pdf.js 6 and the same
  `legacy/build` entry. DOCX: `docxodus` 12.4.1 (MIT, WASM). DOCX offsets only line up when the client engine matches the
  version that parsed the document on the server, so the docxodus range is
  kept narrow.
- License MIT, matching OpenContracts and `caml`. Keep the AllenAI PAWLS
  acknowledgement that OpenContracts carries.

## Approaches

**How formats fit together**

1. *Per-format components plus a thin dispatcher* — **chosen.**
   `<PdfAnnotator>` and `<DocxAnnotator>` take typed, format-specific inputs
   and share one handle and one set of common props; `<DocumentAnnotator>`
   picks one by `document.format`. Engines ship behind separate entry points.
   Chosen because inputs stay strongly typed (PDF needs tokens, DOCX needs
   text), and engine isolation falls out of the entry points.
2. *One component with a runtime renderer registry.* Lets third parties add
   formats without a release, but inputs become loosely typed and engines are
   harder to keep out of bundles. Rejected.
3. *One package per format in a monorepo.* Cleanest dependency isolation, but
   three packages to version for what is one library. Rejected.

**How the PDF state is ported**

- A. *Keep Jotai inside, one private store per viewer* — **chosen.** The
  proven rendering code keeps reading atoms and moves nearly verbatim; props
  and the handle are bridged into the store.
- B. *Rewrite onto plain React context.* One fewer dependency, but rewrites
  the code that is hardest to get right. Rejected.

Both were picked by the project owner in conversation.

## Package shape

- Repo `Open-Source-Legal/react-contract-annotate`, created **private**.
- npm name `@os-legal/react-contract-annotate` *(my call — matches
  `@os-legal/caml`, `@os-legal/ui`)*.
- Single package, ESM only *(my call — avoids duplicated module state across
  entry points in a CJS build)*. Built with tsup, code splitting on.
- Entry points:

  | Import | Contents | Needs installed |
  |---|---|---|
  | `…/pdf` | `PdfAnnotator` + everything in core | `pdfjs-dist` |
  | `…/docx` | `DocxAnnotator` + everything in core | `docxodus` |
  | `…` (root) | `DocumentAnnotator` dispatcher + core; lazy-loads the format chunk | both |
  | `…/core` | types, format contract, shared hooks/helpers | neither |

- Peer dependencies: `react`, `react-dom`, `styled-components`; **optional**
  peers `pdfjs-dist` and `docxodus`.
- Regular dependencies: `jotai` (private, never exposed), `dompurify` (DOCX).
- Dropped relative to the OpenContracts code: Apollo, react-router, lodash
  (small local helpers), uuid (`crypto.randomUUID`), lucide-react (the one
  remaining icon is inline SVG).

## Data model

Plain JSON in, no classes in the public API. Annotation objects are treated as
immutable: normalisation is memoised by object identity, so a host changes an
annotation by passing a new object, not by mutating one in place. Internally the ported
`ServerTokenAnnotation` / `ServerSpanAnnotation` / `PDFPageInfo` classes may
stay.

```ts
interface AnnotationLabel {
  id: string;
  text: string;
  color?: string;          // default grey, as today
  description?: string;
  icon?: string;
}

interface Annotation<TMeta = unknown> {
  id: string;
  annotationLabel: AnnotationLabel;
  rawText?: string;
  page?: number;                      // 0-based first page (token annotations)
  json: MultipageAnnotationJson       // v1  { "0": { bounds, tokensJsons, rawText } }
      | CompactAnnotationJson         // v2  { v: 2, p: { "0": { b, t } } }
      | SpanAnnotationJson;           // { start, end }
  structural?: boolean;
  approved?: boolean;                 // visual state only
  rejected?: boolean;                 // visual state only
  linkUrl?: string | null;            // OC_URL link annotations
  meta?: TMeta;                       // host passthrough, returned in callbacks
}

interface Relation {
  id: string;
  label: AnnotationLabel;
  sourceIds: string[];
  targetIds: string[];
  structural?: boolean;
}

/** Any non-annotation thing to paint and jump to: search hit, chat source,
 *  deep-linked block, diff region. Replaces OpenContracts' separate search
 *  result / chat source / text block overlays. */
interface Highlight {
  id: string;
  color?: string;
  label?: string;
  target:
    | { kind: "tokens"; tokensByPage: Record<number, number[]>;
        boundsByPage?: Record<number, BoundingBox> }   // bounds derived if absent
    | { kind: "bounds"; boundsByPage: Record<number, BoundingBox> }
    | { kind: "span"; start: number; end: number };
}

type PawlsPage = { page: { width: number; height: number; index: number };
                   tokens: PawlsToken[] };             // per docs/architecture/pawls-format.md
```

A highlight's `label`, when given, is drawn as a chip on its box, subject to
`labelDisplay` like an annotation's label (PDF only).

Token annotations and `tokens`/`bounds` highlights render in PDF; span
annotations and `span` highlights render in DOCX. A renderer ignores kinds it
cannot draw and warns once in development.

**Adapter for the export format.** `fromOpenContractsExport(docExport,
labelLookup?)` in core converts an `OpenContractDocExport` (the shape in
`opencontractserver/types/dicts.py`: `labelled_text`, `annotation_json`,
`pawls_file_content`, `content`, `relationships`, label *names* rather than
objects) into `{ annotations, relations, pawls, text }`. Labels are built from
the corpus `text_labels` map when given, otherwise synthesised from the name
with a deterministic colour.

## Common props (every format)

```ts
interface AnnotatorCommonProps<TMeta = unknown> {
  // data
  annotations: Annotation<TMeta>[];
  relations?: Relation[];
  highlights?: Highlight[];

  // state — each is controlled when the value prop is defined, else internal
  selectedAnnotationIds?: string[];
  defaultSelectedAnnotationIds?: string[];
  onSelectionChange?(ids: string[], info: { source: "user" | "api" }): void;

  zoom?: number;
  defaultZoom?: number | "fit-width";          // default "fit-width"
  onZoomChange?(zoom: number): void;

  activeHighlightId?: string | null;
  defaultActiveHighlightId?: string | null;
  onActiveHighlightChange?(id: string | null): void;

  selectedRelationIds?: string[];              // display only, props only

  // display filters (plain props; the host owns these toggles)
  showStructural?: boolean;                    // default false
  showStructuralRelationships?: boolean;       // default false
  showSelectedOnly?: boolean;                  // default false
  showBoundingBoxes?: boolean;                 // default true
  labelDisplay?: "always" | "hover" | "hide";  // default "hover"
  visibleLabelIds?: string[] | null;           // null, undefined or [] = no filter (as today)
  scrollOnSelect?: boolean;                    // default true

  // creating annotations
  readOnly?: boolean;                          // default false
  activeLabel?: AnnotationLabel | null;
  onCreateAnnotation?(draft: AnnotationDraft): void | Promise<void>;
  onTextSelect?(pending: PendingSelection, actions: PendingActions): void;

  // interaction callbacks
  onAnnotationClick?(a: Annotation<TMeta>, e: React.MouseEvent): void;
  onAnnotationHover?(a: Annotation<TMeta> | null): void;
  onOpenLink?(url: string, source: Annotation<TMeta> | "native"): void;

  // render slots — nothing is rendered when a slot is absent
  renderSelectionMenu?(ctx: SelectionMenuContext): React.ReactNode;
  renderAnnotationActions?(a: Annotation<TMeta>, ctx: { selected: boolean;
                                                        hovered: boolean }): React.ReactNode;
  renderLoading?(progress: number | null): React.ReactNode;
  renderError?(error: Error): React.ReactNode;

  // lifecycle
  onDocumentLoad?(info: { pageCount: number | null; text: string }): void;
  onError?(error: Error): void;
  onVisiblePagesChange?(range: [number, number]): void;

  className?: string;
  style?: React.CSSProperties;
}
```

`AnnotationDraft` = `{ json, rawText, page, annotationLabel | null }` where
`json` is v1 multipage token JSON for PDF and `{start, end}` for DOCX.
`PendingSelection` = the draft plus an `anchor` point in viewport
coordinates. `PendingActions` / `SelectionMenuContext` = `{ pending, anchor,
commit(label?), clear(), copyText() }`.

### Behaviour that replaces the removed controls

**After a text selection completes** (drag on PDF, native selection on DOCX),
`onTextSelect` fires, then exactly one of:

1. `renderSelectionMenu` is supplied → the selection stays painted as pending
   and the slot is rendered at the anchor (portalled, clamped to the
   viewport). The host's menu calls `commit` / `clear` / `copyText`.
2. No slot, not `readOnly`, and `activeLabel` is set → committed immediately:
   `onCreateAnnotation(draft)` is called and the pending selection clears.
3. Otherwise → the selection stays pending until the host calls
   `clear()` / `handle.clearPendingSelection()`, or the user presses Escape or
   starts a new selection.

`commit(label?)` calls `onCreateAnnotation` with that label (or
`activeLabel`). The library never adds the draft to `annotations` itself; the
host does, by passing a new array.

The pending selection is **viewer-level state in the store**, not local
state of a page's `SelectionLayer` as it is today, so it survives its page
leaving the virtual window and is what the handle and slot read. Shift-drag
regions on different pages merge into one multipage draft *(my call — it is
what the multipage JSON is for)*.

Kept from the existing selection code: multi-region selection on PDF,
long-press selection on touch, the double-fire guard on mouse-up, Escape to
cancel. Removed: the built-in menu, its keyboard shortcuts, "copy link", the
"add link" modal.

**Rendered annotations** show their box, token highlights and (per
`labelDisplay`) a label chip with the label text. The radial action cloud,
pencil, trash, approve/reject buttons and both modals are gone;
`renderAnnotationActions` puts host content inside the chip.
`approved` / `rejected` still change the box styling.

**Clicks keep each format's current model** *(my call — this is an
extraction, and on PDF a box that swallowed plain mouse-downs would stop users
drag-selecting text under an annotation; structural annotations cover every
paragraph):*

- PDF: Shift-click (or Ctrl/Cmd-click) toggles the annotation in the
  selection. A plain press passes through to the selection layer and *arms* a
  text selection; nothing changes until the pointer moves past a small drag
  tolerance. A drag then clears the current annotation selection and any
  pending selection and selects text. A click without a drag on a blank part
  of the page clears the annotation selection and any pending selection; a
  click without a drag on an annotation or highlight box clears nothing.
  *(Amended during implementation: in OpenContracts the press itself started
  the selection, which with no built-in menu would turn every click on a word
  into a one-word annotation whenever `activeLabel` is set, and would make
  clicking a highlight deselect annotations.)*
- DOCX: plain click replaces the selection, Ctrl/Cmd-click toggles, a click
  on empty text clears.
- `onAnnotationClick` fires for *every* click that lands on an annotation
  without a drag, with or without modifiers, on both formats. A host that
  wants plain-click-to-select on PDF calls `selectAnnotations` from it. When a relation in
`selectedRelationIds` is shown, its endpoints keep the SOURCE / TARGET badges
and are forced visible, as today.

**Links.** An annotation with `linkUrl` is a link: plain click opens it,
modifier-click selects it (current behaviour). Embedded PDF links stay
clickable. Both go to `onOpenLink` when supplied; otherwise `http(s)` URLs
open in a new tab with `noopener` and anything else is ignored.

**Visibility** is the existing `useVisibleAnnotations` logic unchanged:
selected annotations and endpoints of selected relations are always shown;
then `showSelectedOnly`, `showStructural`, and the `visibleLabelIds` filter
apply.

**Scroll requests.** In OpenContracts, scroll-to-annotation is an effect in
`PDF.tsx` keyed on selection, zoom, page heights and the identity of the
annotations array, so it also fires on user clicks, on every zoom change and
whenever a new array arrives; the centring step is an unbounded
`requestAnimationFrame` retry using `document.querySelector` and
`scrollIntoView`. The library replaces that trigger with one explicit scroll
request held in the store (`{ target, behavior, settle }`), and keeps the
mechanics: stretch the virtual window to include the target page, scroll the
page into view, then centre the element once it has mounted. A request is
raised by exactly:

1. the selection changing through props or the handle while `scrollOnSelect`
   is on (first selected annotation);
2. a selection already present when the document finishes loading — the
   deep-link case. If the selected id is not in `annotations` yet, the request
   waits until it is;
3. the active highlight changing through props or the handle;
4. `scrollToAnnotation` / `scrollToHighlight` / `scrollToPage`.

A newer request cancels an older one. User clicks, zoom changes and a new
`annotations` array do **not** scroll *(my call; today zoom re-centres the
selection as a side effect of the effect's dependencies)*. Centring scrolls
the instance's own scroll container by computed offset rather than calling
`scrollIntoView`, so host ancestors do not move; the window-scroll fallback
may keep `scrollIntoView`.

## The handle

One interface for every format, via `ref`:

```ts
interface AnnotatorHandle {
  scrollToAnnotation(id: string, opts?: { select?: boolean;
      behavior?: ScrollBehavior }): Promise<boolean>;   // false if id unknown / not drawable
  scrollToHighlight(id: string, opts?: { activate?: boolean;
      behavior?: ScrollBehavior }): Promise<boolean>;
  scrollToPage(pageIndex: number, opts?: { behavior?: ScrollBehavior }): boolean;

  getZoom(): number;
  setZoom(zoom: number | "fit-width"): void;
  zoomIn(): void;
  zoomOut(): void;

  getSelectedAnnotationIds(): string[];
  selectAnnotations(ids: string[], opts?: { scroll?: boolean }): void;
  clearSelection(): void;

  getPendingSelection(): PendingSelection | null;
  commitPendingSelection(label?: AnnotationLabel): void;
  clearPendingSelection(): void;

  getPageCount(): number | null;               // null for unpaginated formats
  getVisiblePageRange(): [number, number] | null;
  getText(): string;
  findText(query: string, opts?: { caseSensitive?: boolean }): Highlight[];
  getScrollContainer(): HTMLElement | null;
}
```

Setters on controlled state call the matching `on…Change` and do not mutate
internal state; the host's next render applies the value. `findText` returns
highlights the host can pass back through `highlights` (existing
token-string search for PDF, substring search over `text` for DOCX).
The scroll promises resolve `true` once the target has been scrolled into
view, and `false` if the id is unknown, the request is superseded, or the
target never mounts within a bounded wait.

## Format-specific inputs

```ts
// …/pdf
interface PdfAnnotatorProps<M> extends AnnotatorCommonProps<M> {
  source: { url: string; httpHeaders?: Record<string, string>;
            withCredentials?: boolean }
        | { data: Uint8Array | ArrayBuffer }
        | { document: PDFDocumentProxy };     // typed structurally (`PdfDocumentProxyLike`) in core, which may not import pdfjs-dist
  pawls?: PawlsPage[] | CompactPawls | null;   // v1 pages or compact v2 ({ v: 2, p: [...] })
  enableNativeLinks?: boolean;                 // default true
}

// …/docx
interface DocxAnnotatorProps<M> extends AnnotatorCommonProps<M> {
  source: { url: string } | { data: Uint8Array };
  text: string;            // the parser's plain text the offsets index into
  wasmBaseUrl: string;     // where the host serves docxodus' wasm assets
}

// root
type DocumentInput =
  | ({ format: "pdf" }  & Pick<PdfAnnotatorProps<never>, "source" | "pawls" | "enableNativeLinks">)
  | ({ format: "docx" } & Pick<DocxAnnotatorProps<never>, "source" | "text" | "wasmBaseUrl">);
// <DocumentAnnotator document={…} {...commonProps} ref={handle} />
```

**PDF.** The component loads the document itself for `url` / `data` and
reports progress to `renderLoading`. The library does not import a worker
file. Because `GlobalWorkerOptions` must be set on the same module instance
the library loads documents with (`pdfjs-dist/legacy/build/pdf.mjs`), `…/pdf`
exports `configurePdfWorker(workerSrc)` which sets it on that instance; the
README shows the one-line Vite / webpack setup. PAWLs tokens go through the existing
`resolvePageTokens` normalisation. Without `pawls` the pages and
bounds-only annotations render, token highlights and text selection are off.
Initial zoom is fit-to-width (existing `computeFitToWidthZoom`) unless
`zoom` / a numeric `defaultZoom` says otherwise.

**DOCX.** Existing convert-once / project-many pipeline: convert with
docxodus, sanitise with DOMPurify, project annotations and highlights,
toggle label visibility with generated CSS, paginate with
`docxodus/react`'s `PaginatedDocument`. The existing DOM-offset
disambiguation for repeated text is kept. Its built-in selection menu is
replaced by the shared selection behaviour above.

**What DOCX supports at launch** *(my call — the existing DOCX renderer has
less than the PDF one, and closing the whole gap is new work, not
extraction):*

| Common feature | PDF | DOCX |
|---|---|---|
| Annotations, selection (controlled or internal), `scrollToAnnotation` | yes | yes |
| Highlights + active highlight + `scrollToHighlight` | yes | yes (new: today DOCX only scrolls to the selected annotation) |
| Text selection → draft, `onTextSelect`, `renderSelectionMenu` | yes | yes |
| `showStructural`, `visibleLabelIds`, `showSelectedOnly`, forced visibility of selected / relation endpoints | yes | yes (shared filter applied before projection) |
| Zoom | yes | yes — a scale factor; `"fit-width"` resolves to 1 |
| `getText`, `findText`, `onAnnotationClick`, `onAnnotationHover` | yes | yes |
| `labelDisplay` | yes | `"hide"` vs shown only; no hover mode |
| `renderAnnotationActions` | yes | **no** — the DOCX label chip is a CSS `::before`, not an element |
| `approved` / `rejected` styling, SOURCE / TARGET badges | yes | **no** |
| `linkUrl` click-to-open | yes | **no** |
| `scrollToPage`, `getPageCount`, `getVisiblePageRange` | yes | returns `false` / `null` |

Unsupported props are accepted and ignored on DOCX, with a one-time
development warning, and the matrix is in the README.

**DOCX behaviour that deliberately differs from OpenContracts** *(amended
during implementation; each is a defect in the OpenContracts renderer at
`98286cabf` that the port does not reproduce):*

- Structural annotations are actually drawn when `showStructural` is on (in
  OpenContracts the toggle projected nothing).
- The projected HTML's pretty-printing whitespace is not rendered as text, so
  the document no longer gains a blank line and an indent once annotations
  are projected.
- A zoomed page that overflows is scrollable to its left edge instead of
  being cut off.
- Selecting repeated text resolves to the occurrence the user selected, not
  the last one.

**Overlap rule.** The DOCX engine (docxodus 12.4.1) draws only one of any
two overlapping spans, strictly nested ones included. The library's policy:
user annotations, highlights and the pending selection take precedence over
structural annotations, so a structural span that overlaps one of them is
left out of the projection. Among non-structural spans the engine's choice
stands. `scrollToAnnotation` / `scrollToHighlight` resolve `false` promptly
for a target the projection did not draw. (An annotation hidden only by the
display filters still counts as drawable, so `{ select: true }` can reveal
it; without `select` such a scroll resolves `false` at the bounded timeout,
on both formats.)

**Isolation.** The converted document is untrusted input. Its stylesheet is
scoped to its viewer instance: it must not restyle the host page or another
viewer, and host CSS class names must not collide with the document's.
Document CSS, in the stylesheet and in inline styles, is filtered by
allow-list: a fixed set of presentational properties and a conservative
value grammar. A document therefore cannot make the browser fetch anything,
declare names the page shares (anchors, counters, containers, view
transitions), or place a box outside its viewer. The viewer's frame contains
layout, paint and style as a second barrier. Styling outside the allow-list
is dropped (images and gradients in CSS, newer colour functions).

Two limits are accepted. Inside its own viewer the document controls how its
content looks, and annotation marks are drawn on that content, so a hostile
document can hide or imitate them there; a host reviewing adversarial
documents should treat its own annotation list, not the rendering, as the
record. A hostile document can also exhaust or crash the page: very large
input, or CSS nested deeply enough to crash the browser's own parser, which
happens while the converted HTML is first parsed, before any filter runs.
That is not defended against. A host that must survive such documents should
render them in an isolated frame or process.

**Scrolling element.** The component's root is the scroll container and
fills its parent; the parent must have a height. The existing fallback to
window scrolling when the root does not overflow is kept.

## Internals

```
src/
  core/        types, annotation normalisation (v1/v2/span), geometry utils,
               AnnotatorProvider (private Jotai store), controllable-state
               bridge, visibility filter, handle plumbing, format contract,
               shared pieces (label chip, pending-selection + slot host),
               fromOpenContractsExport
  pdf/         PdfAnnotator, loader, PDF/PDFPage/SelectionLayer/
               NativeLinkLayer, Selection*, highlight overlay, PDFPageInfo
  docx/        DocxAnnotator, offset utils
  index.ts     DocumentAnnotator (React.lazy per format)
```

- **One store per instance.** `AnnotatorProvider` creates a Jotai store with
  `createStore()` and wraps the renderer in `<Provider store>`. Atoms are the
  ported ones minus everything app-specific (corpus, chat tray, sidebar,
  loading-state, permissions). Display toggles and selection, which are Apollo
  reactive vars in OpenContracts, become atoms fed from props.
- **Controlled/uncontrolled bridge.** One helper per bridged value: when the
  value prop is defined it is written into the store on change and internal
  writes are routed to the `on…Change` callback only; when undefined the atom
  is the source of truth and the callback is a notification.
- **No page-global lookups.** `document.querySelector('.selection_…')` and
  `getElementById('SEARCH_RESULT_…')` become lookups scoped to the instance
  root (or the existing ref registry). Element ids that could collide across
  instances are removed or prefixed with an instance id.
- **Highlights replace three overlays.** Search results, chat sources and the
  `?tb=` text block all become `Highlight`s rendered by one overlay built
  from the existing `ResultBoundary` / token-group components. All supplied
  highlights are painted; the active one is emphasised and scrolled to. The
  virtual window keeps the active highlight's page mounted, as it does today
  for the selected search hit.
- **Format contract** (`…/core`), for whoever adds the next format: a
  renderer is a component that renders inside `AnnotatorShell` (which owns
  the provider, common props, slots and the format-agnostic half of the
  handle) and registers a small driver — `scrollToAnnotation`,
  `scrollToHighlight`, `scrollToPage`, `getText`, `findText`,
  `getPageCount`, `getVisiblePageRange` — plus the annotation kind it draws
  (`token` or `span`). PDF and DOCX are built on exactly this contract, so it
  is exercised twice before anyone else uses it.
- **Theming.** Colours come from labels. Structural colours, z-indices and
  the default font are CSS custom properties on the root with defaults.

## Testing

- **Unit (Vitest).** Port the tests that cover moved code:
  `types/__tests__/{pdf,annotations}`, `SelectionLayer.*` (minus the URL-modal
  flow, reworked for the store-level pending selection), `NativeLinkLayer`, `SelectionBoundary`, `ResultBoundary`,
  `getGlobalOffset`, `useVisibleAnnotations`, and the `transform` /
  `compactAnnotationJson` suites. New: controllable-state bridge,
  `fromOpenContractsExport`, highlight normalisation.
- **Component (Playwright CT, real Chromium, real fixtures.)** Fixtures
  copied from OpenContracts: `eton-agreement.pdf`, `usc-title-1.pdf`,
  `test.docx`, with PAWLs / text / annotation JSON for each. Must cover:
  - annotations land on the right tokens at two zoom levels (PDF);
  - `scrollToAnnotation` for an annotation on an unmounted far page;
  - controlled vs uncontrolled selection and zoom;
  - drag-select → `onTextSelect` → each of the three outcomes, with the
    draft's token ids and text checked;
  - highlight activation + jump;
  - scroll requests: prop-driven select scrolls, a user click does not, a
    zoom change does not, a selection present at mount scrolls once loaded;
  - nothing but the document is rendered when no slots are given;
  - two viewers side by side stay independent;
  - DOCX: projection, selection → span draft, `scrollToAnnotation`.
- **Parity check.** For one PDF fixture and annotation set, the box
  coordinates the library renders are compared against values captured from
  OpenContracts' renderer at the same zoom.
- CI on GitHub Actions: typecheck, unit, CT, build.

## Demo

`examples/demo`: a small Vite app with the two fixtures where plain HTML
buttons outside the viewer drive the handle (zoom, jump, select, label to
apply) and a toggle switches between controlled and internal state. It is
the manual test bed and the README's usage example.

## Left to the builder

- Internal file and atom names; how much of the ported classes survives
  behind the JSON API.
- Exact CSS custom property names and defaults.
- The exact `pdfjs-dist` peer range within major 6 (start at `^6.5.438`).
- The `docxodus` peer range around 12.4.x.
- Whether the PAWLs / annotation fixtures for the two PDFs are captured from
  a running OpenContracts or generated another way.
- Tooling versions (tsup, Vitest, Playwright), following `caml` where it has
  a precedent.
