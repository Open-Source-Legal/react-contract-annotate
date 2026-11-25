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
  or two-phase scroll code. Those are moved, not redesigned.

## Constraints

- Source of truth for the port is OpenContracts `main` as of 2026-11-24.
  Key files: `renderers/pdf/{PDF,PDFPage,SelectionLayer,NativeLinkLayer}.tsx`,
  `display/components/*`, `types/{pdf,annotations}.ts`,
  `renderers/docx/{DocxAnnotator.tsx,docxOffsetUtils.ts}`,
  `hooks/useVisibleAnnotations.ts`, `context/*Atom*.tsx`, and from
  `frontend/src/utils/`: `transform.tsx` (bounds maths, `resolvePageTokens`,
  `normalizeTokensToPdfViewport`), `compactAnnotationJson.ts`, `colorUtils`,
  `pdfZoom.ts`, `layout.ts`, plus `annotator/utils.ts`
  (`createTokenStringSearch`, `convertAnnotationTokensToText`).
- React 18+. styled-components 6 (already used by the ported code).
- pdf.js: OpenContracts runs `pdfjs-dist` 4.10.x. DOCX: `docxodus` 12.4.1
  (MIT, WASM). DOCX offsets only line up when the client engine matches the
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

Plain JSON in, no classes in the public API. Internally the ported
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
  visibleLabelIds?: string[] | null;           // null = all labels
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

Kept from the existing selection code: multi-region selection on PDF,
long-press selection on touch, the double-fire guard on mouse-up, Escape to
cancel. Removed: the built-in menu, its keyboard shortcuts, "copy link", the
"add link" modal.

**Rendered annotations** show their box, token highlights and (per
`labelDisplay`) a label chip with the label text. The radial action cloud,
pencil, trash, approve/reject buttons and both modals are gone;
`renderAnnotationActions` puts host content inside the chip. Clicking an
annotation toggles it in the selection and calls `onAnnotationClick`.
`approved` / `rejected` still change the box styling. When a relation in
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

**Selecting scrolls.** When the selection changes through props or the handle
and `scrollOnSelect` is on, the viewer scrolls to the first selected
annotation (existing two-phase scroll: bring the page into the virtual window,
then centre the element once it mounts). User clicks do not trigger a scroll.

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
The scroll promises resolve once the target has been scrolled into view, and
`false` if it never mounts within a bounded wait.

## Format-specific inputs

```ts
// …/pdf
interface PdfAnnotatorProps<M> extends AnnotatorCommonProps<M> {
  source: { url: string; httpHeaders?: Record<string, string>;
            withCredentials?: boolean }
        | { data: Uint8Array | ArrayBuffer }
        | { document: PDFDocumentProxy };
  pawls?: PawlsPage[] | null;
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
reports progress to `renderLoading`. The host configures the pdf.js worker
(`GlobalWorkerOptions.workerSrc`), documented in the README; the library does
not import a worker file. PAWLs tokens go through the existing
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
  flow), `NativeLinkLayer`, `SelectionBoundary`, `ResultBoundary`,
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
- The `pdfjs-dist` peer range: start at `^4.7.0`; widen only for majors the
  CT suite passes on.
- The `docxodus` peer range around 12.4.x.
- Whether the PAWLs / annotation fixtures for the two PDFs are captured from
  a running OpenContracts or generated another way.
- Tooling versions (tsup, Vitest, Playwright), following `caml` where it has
  a precedent.
