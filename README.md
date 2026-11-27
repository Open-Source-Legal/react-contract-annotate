# @os-legal/react-contract-annotate

A control-free React viewer and annotator for [OpenContracts](https://github.com/Open-Source-Legal/OpenContracts)
annotations on **PDF** and **DOCX**.

It renders a document with annotations on top and exposes an API to drive it. It
ships **no controls**: no toolbar, zoom buttons, label picker, sidebar, menus or
modals. Your application supplies its own UI and talks to the viewer through
props, callbacks, render slots and a `ref` handle. Nothing is rendered beyond
the document, its annotations and highlights unless you supply a render slot or
your own [buttons beside the labels](#controls-beside-a-label).
The library never fetches annotations and never persists anything: it reports a
selection and you decide what to do with it.

**[Live demo](https://open-source-legal.github.io/react-contract-annotate/)**:
a PDF and a DOCX (two public-domain model agreements of the U.S. National
Institutes of Health) with sample annotations, and the demo's own controls
around the viewer.

Selection, zoom and the active highlight each work either **controlled** by you
or **managed internally**. Several viewers can share a page without affecting
each other.

## Install

```bash
yarn add @os-legal/react-contract-annotate     # or: npm install @os-legal/react-contract-annotate
```

The package is ESM only. The root, `./core` and `./pdf` entries can also be
imported by Node itself (a test runner or a server that does not bundle its
dependencies); `./docx` needs a bundler, because docxodus 12.4.1's own entry
has an import Node does not resolve.

Peer dependencies:

| Package | Range | Needed for |
|---|---|---|
| `react`, `react-dom` | `>=18` | always |
| `styled-components` | `^6` | always |
| `pdfjs-dist` | `^6.5.438` (optional) | PDF |
| `docxodus` | `~12.4.1` (optional) | DOCX |

Install only the engine for the format you show. DOCX character offsets only line
up when the client engine matches the version that parsed the document on the
server, which is why the `docxodus` range is narrow. Regular dependencies are
`jotai` (private to the library, never exposed) and `dompurify` (DOCX).

## Entry points

ESM only. Each engine sits behind its own entry point:

| Import | Contents | Needs installed |
|---|---|---|
| `@os-legal/react-contract-annotate/pdf` | `PdfAnnotator`, `configurePdfWorker`, everything in `core` | `pdfjs-dist` |
| `@os-legal/react-contract-annotate/docx` | `DocxAnnotator`, everything in `core` | `docxodus` |
| `@os-legal/react-contract-annotate` | `DocumentAnnotator` dispatcher, everything in `core`; lazy-loads the engine of the document's format | both (the host's bundler must be able to resolve both `pdfjs-dist` and `docxodus`) |
| `@os-legal/react-contract-annotate/core` | types, `fromOpenContractsExport`, the format contract and hooks | neither |

A host that shows one format imports that entry and installs only that engine.
The dispatcher chooses the viewer by `document.format` (`{ format: "pdf",
source, pawls }` or `{ format: "docx", source, text, wasmBaseUrl }`); changing
the format mounts a fresh viewer with its own state. If the lazily loaded chunk
fails to load, the error surfaces at your React error boundary, not through
`onError`.

## Setup

### pdf.js worker

pdf.js needs the URL of its worker script. The library does not import a worker
file; your bundler emits it and you hand over its URL. The worker option must be
set on the pdf.js instance the library loads documents with
(`pdfjs-dist/legacy/build/pdf.mjs`), so use `configurePdfWorker` from the `pdf`
entry rather than setting `GlobalWorkerOptions` yourself, once, before the first
viewer mounts:

```ts
import { configurePdfWorker } from "@os-legal/react-contract-annotate/pdf";
import workerSrc from "pdfjs-dist/legacy/build/pdf.worker.mjs?url"; // Vite

configurePdfWorker(workerSrc);
```

With another bundler, pass the URL it produces for
`pdfjs-dist/legacy/build/pdf.worker.mjs`.

### docxodus WebAssembly runtime

docxodus runs on WebAssembly. Serve the contents of
`node_modules/docxodus/dist/wasm/` (`.wasm` files as `application/wasm`) from a
URL of your choosing and pass it as `wasmBaseUrl`, for example
`"/docxodus-wasm/"`. docxodus initialises once per page, so the first
`wasmBaseUrl` a page uses wins. `examples/demo/vite.config.ts` serves the
directory in the dev server and copies it into the build.

## Usage

The viewer's root element is the scroll container and fills its parent: **the
parent must have a height**.

### PDF

`pawls` are the PAWLS tokens of the document (v1 pages, or the compact v2 form
`{ v: 2, p: [...] }`). Without them the pages and bounds-only annotations render,
but token highlights and text selection are off. The initial zoom fits the page
width unless `zoom` or a numeric `defaultZoom` says otherwise. `source` is a
`{ url }` (with optional `httpHeaders` and `withCredentials`), `{ data }` (bytes)
or `{ document }` (a pdf.js `PDFDocumentProxy` you loaded; the library never
destroys it). A `{ data }` source is keyed by the identity of its bytes object:
a new object loads the document again, even with the same bytes, so keep the
one you have.

```tsx
import {
  configurePdfWorker,
  PdfAnnotator,
} from "@os-legal/react-contract-annotate/pdf";
import type {
  Annotation,
  PawlsInput,
} from "@os-legal/react-contract-annotate/pdf";
import workerSrc from "pdfjs-dist/legacy/build/pdf.worker.mjs?url";

// Once, before the first viewer mounts.
configurePdfWorker(workerSrc);

export function Contract({
  annotations,
  pawls,
}: {
  annotations: Annotation[];
  pawls: PawlsInput;
}) {
  return (
    // The viewer fills its parent, which must have a height.
    <div style={{ height: 700 }}>
      <PdfAnnotator
        source={{ url: "/contract.pdf" }}
        pawls={pawls}
        annotations={annotations}
      />
    </div>
  );
}
```

### DOCX

`text` is the parser's plain text; a DOCX annotation's `{ start, end }` index
into it. `source` is `{ url }` or `{ data }` (a `Uint8Array`, keyed by its
identity as on PDF).

```tsx
import { DocxAnnotator } from "@os-legal/react-contract-annotate/docx";
import type { Annotation } from "@os-legal/react-contract-annotate/docx";

export function Agreement({
  annotations,
  text,
}: {
  annotations: Annotation[];
  /** The parser's plain text; the annotations' `{ start, end }` index into it. */
  text: string;
}) {
  return (
    <div style={{ height: 700 }}>
      <DocxAnnotator
        source={{ url: "/agreement.docx" }}
        text={text}
        wasmBaseUrl="/docxodus-wasm/"
        annotations={annotations}
      />
    </div>
  );
}
```

`examples/demo` (the live demo above) shows both formats behind the dispatcher
with host-side controls: an annotation list that jumps and filters by label, a
selection menu in the `renderSelectionMenu` slot, relationships, zoom, search and
a controlled / internal switch. Its documents are loaded from OpenContracts
exports through `fromOpenContractsExport`. The samples above and below are kept
there under `examples/demo/src/snippets/` so that they are type-checked.

## Data

All inputs are plain JSON; no class instances cross the boundary. Exact types:
`src/core/types.ts`.

- `Annotation` — `{ id, annotationLabel, json, page?, rawText?, structural?,
  approved?, rejected?, linkUrl?, meta? }`. `json` is v1 multipage token JSON
  (`{ "0": { bounds, tokensJsons, rawText } }`), the compact v2 form
  (`{ v: 2, p: { "0": { b, t } } }`) or a span (`{ start, end }`). Token
  annotations render in PDF, span annotations in DOCX; a viewer ignores the kind
  it cannot draw and warns once in development. `approved` and `rejected` are
  visual state only. `meta` is passed through and returned in callbacks.
- `Relation` — `{ id, label, sourceIds, targetIds, structural? }`, displayed
  only (creating and editing relations is out of scope).
- `Highlight` — anything that is not an annotation but should be painted and
  jumped to (a search hit, a chat source, a deep-linked block). `target` is
  `{ kind: "tokens", tokensByPage }`, `{ kind: "bounds", boundsByPage }` (PDF) or
  `{ kind: "span", start, end }` (DOCX). An optional `label` is drawn as a chip
  on the box, subject to `labelDisplay` (PDF only).

**Colours** (`AnnotationLabel.color`, `Highlight.color`) are a hex colour
(`#rgb`, `#rrggbb`, `#rrggbbaa`), a colour name, or `rgb()` / `hsl()` with
numbers only; anything else falls back to the default. On a PDF the box is
tinted from hex only (a name or a function colours the chip and the tokens, and
the box falls back to yellow, as in OpenContracts); a DOCX takes any of them.

**Annotations, relations and highlights are immutable inputs.** Change one by
passing a new object (or a new array), never by mutating one in place:
normalisation is memoised by object identity.

### Common props

| Group | Props |
|---|---|
| Data | `annotations`, `relations`, `highlights` |
| State | `selectedAnnotationIds` / `defaultSelectedAnnotationIds` / `onSelectionChange(ids, { source })`, `zoom` / `defaultZoom` / `onZoomChange`, `activeHighlightId` / `defaultActiveHighlightId` / `onActiveHighlightChange`, `selectedRelationIds` (props only) |
| Display | `showStructural`, `showStructuralRelationships`, `showSelectedOnly`, `showBoundingBoxes`, `labelDisplay` (`"always" \| "hover" \| "hide"`), `visibleLabelIds` (`null`, `undefined` or `[]` = no filter), `scrollOnSelect` |
| Creating | `readOnly`, `activeLabel`, `onCreateAnnotation(draft)`, `onTextSelect(pending, actions)` |
| Interaction | `onAnnotationClick`, `onAnnotationHover`, `onOpenLink(url, source)` |
| Controls on annotations | `annotationActions` (see [Controls beside a label](#controls-beside-a-label)) |
| Slots | `renderSelectionMenu`, `renderAnnotationActions`, `renderLoading`, `renderError` |
| Lifecycle | `onDocumentLoad({ pageCount, text })`, `onError`, `onVisiblePagesChange`, `className`, `style` |

Defaults and semantics are documented on `AnnotatorCommonProps`. Every format
takes them; what DOCX does not support is listed in its support matrix below.

What you render in a slot, and the `icon` of an annotation action, runs with
your own React context: your providers reach it, Jotai's included. The viewer
keeps its state in a private store that it never puts in Jotai's context, so
an atom hook in slot content reads your store, not the viewer's.

### Controlled and internal state

Selection, zoom and the active highlight are each **controlled** when the value
prop (`selectedAnnotationIds`, `zoom`, `activeHighlightId`) is defined, and
**internal** otherwise (seed with the `default…` prop). In controlled mode the
viewer never changes the value itself: it calls the matching `on…Change` and
shows what you pass in on the next render, including when the change came from
the handle. In internal mode the callback only notifies.

```tsx
import { PdfAnnotator } from "@os-legal/react-contract-annotate/pdf";
import type {
  Annotation,
  AnnotatorHandle,
  PawlsInput,
} from "@os-legal/react-contract-annotate/pdf";
import { useRef, useState } from "react";

interface Props {
  annotations: Annotation[];
  pawls: PawlsInput;
}

/** The host owns zoom and selection: it passes them in and applies changes. */
export function ControlledViewer({ annotations, pawls }: Props) {
  const handle = useRef<AnnotatorHandle>(null);
  const [zoom, setZoom] = useState(1);
  const [selected, setSelected] = useState<string[]>([]);
  return (
    <>
      {/* The handle's setters call the change callbacks; the next render applies them. */}
      <button type="button" onClick={() => handle.current?.zoomIn()}>
        Zoom in
      </button>
      <button
        type="button"
        onClick={() =>
          void handle.current?.scrollToAnnotation("a-far", { select: true })
        }
      >
        Jump
      </button>
      <div style={{ height: 700 }}>
        <PdfAnnotator
          ref={handle}
          source={{ url: "/contract.pdf" }}
          pawls={pawls}
          annotations={annotations}
          zoom={zoom}
          onZoomChange={setZoom}
          selectedAnnotationIds={selected}
          onSelectionChange={setSelected}
        />
      </div>
    </>
  );
}

/** The viewer owns zoom and selection; the callbacks only notify. */
export function InternalViewer({ annotations, pawls }: Props) {
  return (
    <div style={{ height: 700 }}>
      <PdfAnnotator
        source={{ url: "/contract.pdf" }}
        pawls={pawls}
        annotations={annotations}
        defaultZoom="fit-width"
        defaultSelectedAnnotationIds={[]}
        onSelectionChange={(ids, { source }) => console.log(ids, source)}
      />
    </div>
  );
}
```

## The handle

`ref` gives an `AnnotatorHandle`, the same interface for every format:

- `scrollToAnnotation(id, { select?, behavior? })` and
  `scrollToHighlight(id, { activate?, behavior? })` return `Promise<boolean>`;
  `scrollToPage(pageIndex)` returns `boolean`.
- `getZoom()`, `setZoom(zoom | "fit-width")`, `zoomIn()`, `zoomOut()`.
- `getSelectedAnnotationIds()`, `selectAnnotations(ids, { scroll? })`,
  `clearSelection()`.
- `getPendingSelection()`, `commitPendingSelection(label?)`,
  `clearPendingSelection()`.
- `getPageCount()`, `getVisiblePageRange()` (`null` for unpaginated formats),
  `getText()`, `findText(query, { caseSensitive? })`, `getScrollContainer()`.

A scroll promise resolves `true` once the target has been scrolled into view, and
`false` if the id is unknown or the format cannot draw it, the request is
superseded by a newer one, or the target never mounts within a bounded wait. An
annotation that the display filters hide (`showStructural`, `visibleLabelIds`,
`showSelectedOnly`) still counts as drawable: `scrollToAnnotation` without
`{ select: true }` resolves `false` at the bounded timeout, and with it the
annotation is selected, revealed and scrolled to. A jump to an id the viewer
has not received yet resolves `false`: make it from an effect or a handler after
the render that supplies the target.

`findText` returns `Highlight[]` that you can pass straight back through
`highlights` (token-string search on PDF, substring search over `text` on DOCX).

### Scroll requests

The viewer scrolls only when asked: when the selection changes through props or
the handle while `scrollOnSelect` is on (to the first selected annotation); when a
selection is already present as the document finishes loading (a deep link; if
the id is not in `annotations` yet, the request waits until it is); when the
active highlight changes through props or the handle; and on
`scrollToAnnotation` / `scrollToHighlight` / `scrollToPage`. A newer request
cancels an older one. User clicks, zoom changes and new `annotations` arrays do
**not** scroll. Centring scrolls the viewer's own container by computed offset,
so host ancestors do not move.

## Creating annotations

The library never adds a draft to `annotations`; you do, by passing a new array.
After a text selection completes (a drag on PDF, a native selection on DOCX),
`onTextSelect(pending, actions)` fires, then exactly one of three outcomes:

1. **`renderSelectionMenu` is supplied** — the selection stays painted as pending
   and the slot is rendered at the anchor (portalled, clamped to the viewport).
   Your menu calls `commit(label?)`, `clear()` or `copyText()`.
2. **No slot, not `readOnly`, and `activeLabel` is set** — committed
   immediately: `onCreateAnnotation(draft)` is called and the pending selection
   clears.
3. **Otherwise** — the selection stays pending until you call `clear()` (or
   `handle.clearPendingSelection()`), the user presses Escape, or the user starts
   a new selection.

`commit(label?)` calls `onCreateAnnotation` with that label, or with
`activeLabel`. A draft is `{ json, rawText, page, annotationLabel | null }`:
`json` is v1 multipage token JSON for PDF and `{ start, end }` for DOCX. A pending
selection carries an `anchor` point too (viewport coordinates). The pending
selection is viewer-level state, so it survives its page leaving the virtual
window; shift-drag regions on different pages merge into one multipage draft.
PDF also supports multi-region selection and long-press selection on touch.

## Controls beside a label

`annotationActions` is an array of your own controls for an annotation, such as
edit, delete or approve. Each is `{ id, label, icon?, onClick(annotation, event),
isVisible?(annotation), isDisabled?(annotation) }`. The library draws one button
per action beside the annotation's label, in the array's order, and calls
`onClick` with your own annotation object; what the action does is yours.

```tsx
import { DocumentAnnotator } from "@os-legal/react-contract-annotate";
import type {
  Annotation,
  AnnotationAction,
  DocumentInput,
} from "@os-legal/react-contract-annotate";
import { useMemo } from "react";

export function Reviewable({
  document,
  annotations,
  onEdit,
  onDelete,
}: {
  document: DocumentInput;
  annotations: Annotation[];
  onEdit(annotation: Annotation): void;
  onDelete(id: string): void;
}) {
  // The same array while the actions are the same.
  const actions = useMemo<AnnotationAction[]>(
    () => [
      {
        id: "edit",
        label: "Edit",
        icon: <span aria-hidden="true">✎</span>,
        onClick: (annotation) => onEdit(annotation),
      },
      {
        id: "delete",
        label: "Delete",
        icon: <span aria-hidden="true">✕</span>,
        onClick: (annotation) => onDelete(annotation.id),
        // Not offered for the document's own structure.
        isVisible: (annotation) => !annotation.structural,
      },
    ],
    [onEdit, onDelete]
  );
  return (
    <DocumentAnnotator
      document={document}
      annotations={annotations}
      annotationActions={actions}
    />
  );
}
```

- **`icon`** is any React node (an icon component, an `<svg>`, text) and is drawn
  in the label's text colour; without one the button shows `label`. `label` is
  always the button's accessible name and tooltip.
- **`isVisible`** leaves an action out for an annotation; **`isDisabled`** draws
  it greyed and unclickable. An annotation no action is offered for gets no
  buttons.
- **When they show.** The buttons are part of the label chip, so `labelDisplay`
  decides: `"hover"` (the default) shows them for the annotation under the
  pointer and for selected ones, `"always"` for every annotation, `"hide"`
  never. On a DOCX the labels themselves are always drawn, and the buttons come
  in a chip over the label of the annotation under the pointer and of each
  selected one.
- **Clicks.** A click on a button is not a click on the annotation: it fires no
  `onAnnotationClick`, changes no selection and starts no text selection.
- **Identity.** The array is compared by identity, like the other inputs. Keep
  it stable (`useMemo`) or every label is drawn again on each of your renders.
- Each button is `button[data-rca-annotation-action="<id>"]`, for your own CSS.
  `renderAnnotationActions(annotation, { selected, hovered })` remains for
  content that is not a button; it is drawn after the buttons.

## Clicks, selection and links

Each format keeps its own click model:

- **PDF.** Shift-click (or Ctrl/Cmd-click) toggles the annotation in the
  selection. A plain press passes through to the selection layer and arms a text
  selection; nothing changes until the pointer moves past a small drag tolerance.
  A drag then clears the current annotation selection and any pending selection
  and selects text. A click without a drag on a blank part of the page clears the
  annotation selection and any pending selection; a click without a drag on an
  annotation or highlight box clears nothing.
- **DOCX.** A plain click replaces the selection, Ctrl/Cmd-click toggles, and a
  click on empty text clears.
- **`onAnnotationClick`** fires for every click that lands on an annotation
  without a drag, with or without modifiers, on both formats. To get
  plain-click-to-select on PDF, call `selectAnnotations` from it.
- **Links (PDF).** An annotation with `linkUrl` is a link: a plain click opens it,
  a modifier-click selects it. Links embedded in the PDF stay clickable
  (`enableNativeLinks`, default true). Both go to `onOpenLink(url, source)` when
  supplied; otherwise `http(s)` URLs open in a new tab with `noopener` and anything
  else is ignored. An embedded link under an annotation box is covered by the box
  (both stack at `2`) and cannot be clicked there; raise `--rca-z-native-links`
  to keep such links clickable.
- **Links (DOCX).** Hyperlinks inside a DOCX follow the same policy, reported with
  source `"native"` and the URL as the document wrote it (a relative URL is not
  resolved, so without `onOpenLink` it is ignored). A click on one never navigates
  your page; a link to a bookmark in the document scrolls the viewer to it.

**Visibility.** Selected annotations, and the endpoints of the relations in
`selectedRelationIds`, are always shown (those endpoints keep their SOURCE /
TARGET badges on PDF); then `showSelectedOnly`, `showStructural` and the
`visibleLabelIds` filter apply.

## DOCX

### Support matrix

| Feature | PDF | DOCX |
|---|---|---|
| Annotations, selection (controlled or internal), `scrollToAnnotation` | yes | yes |
| Highlights, active highlight, `scrollToHighlight` | yes | yes |
| Text selection to a draft, `onTextSelect`, `renderSelectionMenu` | yes | yes |
| `showStructural`, `visibleLabelIds`, `showSelectedOnly`, forced visibility of selected annotations and relation endpoints | yes | yes |
| Zoom | yes | yes: a scale factor; `"fit-width"` resolves to 1 |
| `getText`, `findText`, `onAnnotationClick`, `onAnnotationHover` | yes | yes |
| `labelDisplay` | yes | `"hide"` or shown only; no hover mode |
| `annotationActions`, `renderAnnotationActions` | yes: in every label chip that is shown | yes: in a chip over the label of the annotation under the pointer and of each selected one |
| `approved` / `rejected` styling, SOURCE / TARGET badges | yes | **no** |
| `linkUrl` click-to-open | yes | **no** |
| `scrollToPage`, `getPageCount`, `getVisiblePageRange` | yes | returns `false` / `null` |
| `showBoundingBoxes`, `onVisiblePagesChange`, making a highlight active by clicking it | yes | **no** (no warning) |

Other unsupported props are accepted and ignored on DOCX, with a one-time
development warning.

### Overlap rule

The DOCX engine (docxodus 12.4.1) draws only one of any two overlapping spans,
strictly nested ones included. The library's policy: user annotations,
highlights and the pending selection take precedence over structural
annotations, so a structural span that overlaps one of them is left out of the
projection. Among non-structural spans the engine's choice stands.
`scrollToAnnotation` / `scrollToHighlight` resolve `false` promptly for a target
the projection did not draw.

### DOCX behaviour that deliberately differs from OpenContracts

Each is a defect in the OpenContracts renderer (at `98286cabf`) that the port does
not reproduce:

- Structural annotations are actually drawn when `showStructural` is on (in
  OpenContracts the toggle projected nothing).
- The projected HTML's pretty-printing whitespace is not rendered as text, so the
  document no longer gains a blank line and an indent once annotations are
  projected.
- A zoomed page that overflows is scrollable to its left edge instead of being
  cut off.
- Selecting repeated text resolves to the occurrence the user selected, not the
  last one.
- Annotations are drawn on a document whose HTML has a line break, a table or an
  image. docxodus reads the HTML it projects onto as XML; OpenContracts hands
  it HTML in which those elements have no end tag, the projection fails and the
  document is shown without any annotation.
- An annotation that crosses runs of different formatting at a space (a bold
  defined term followed by plain text) is drawn. docxodus' HTML has a no-break
  space at the edge of a run where the document's text has a plain one, so such
  an annotation's text was never found.

### DOCX and untrusted documents

The converted document is untrusted input. What the library guarantees:

- The document's stylesheet is **scoped** to its viewer instance: it cannot
  restyle the host page or another viewer, and host CSS class names cannot
  collide with the document's.
- Document CSS, in the stylesheet and in inline styles, is filtered by an
  **allow-list** (a fixed set of presentational properties and a conservative
  value grammar). A document cannot make the browser fetch a URL of its choosing,
  declare names the page shares (anchors, counters, containers, view
  transitions), or place a box outside its viewer. It can name a font the host
  page itself declared, which the browser then loads from the host's URL.
- The viewer's frame **contains** layout, paint and style: a second barrier for
  boxes, and the only one for list numbering.
- The document's HTML is reduced to the elements and attributes docxodus writes
  (no SVG, MathML, media, forms, embedded content or popovers); an image keeps
  its source only when it is a `data:` URL, and links go through the link policy
  above. With the CSS allow-list, this is what keeps the document from making the
  browser fetch a URL of its choosing.

Styling outside the allow-list is dropped: images and gradients in CSS,
transform functions, newer colour functions, `content` and `cursor`,
`visibility` other than `hidden`, `collapse` or `inherit`, `pointer-events`
other than `none`, and font names that need a CSS escape.

Two limits are accepted:

- Inside its own viewer the document controls how its content looks, and
  annotation marks are drawn on that content, so a hostile document can hide or
  imitate marks there. Treat your own annotation list, not the rendering, as the
  record when reviewing adversarial documents.
- A hostile document can exhaust or crash the page: very large input, or CSS
  nested deeply enough to crash the browser's own parser, which happens while the
  converted HTML is first parsed, before any filter runs. That is not defended
  against. If you must survive such documents, render them in an isolated frame or
  process.

## OpenContracts export

`fromOpenContractsExport(docExport, labelLookup?)` (from `…/core`) converts an
`OpenContractDocExport` (the shape in `opencontractserver/types/dicts.py`:
`labelled_text`, `annotation_json`, `pawls_file_content`, `content`,
`relationships`, label *names* rather than objects) into `{ annotations,
relations, pawls, text }`. Labels come from the corpus' `text_labels` map when
given, otherwise they are synthesised from the name with a deterministic colour.

```tsx
import { PdfAnnotator } from "@os-legal/react-contract-annotate/pdf";
import { fromOpenContractsExport } from "@os-legal/react-contract-annotate/core";
import type {
  OpenContractDocExport,
  OpenContractLabelLookup,
} from "@os-legal/react-contract-annotate/core";
import { useMemo } from "react";

export function ExportedDocument({
  docExport,
  labels,
  pdfUrl,
}: {
  docExport: OpenContractDocExport;
  /** The corpus' `text_labels`; without it labels are built from their names. */
  labels?: OpenContractLabelLookup;
  pdfUrl: string;
}) {
  // `text` is the same adapter's input for a DOCX viewer.
  const { annotations, relations, pawls } = useMemo(
    () => fromOpenContractsExport(docExport, labels),
    [docExport, labels]
  );
  return (
    <div style={{ height: 700 }}>
      <PdfAnnotator
        source={{ url: pdfUrl }}
        pawls={pawls}
        annotations={annotations}
        relations={relations}
      />
    </div>
  );
}
```

## Theming

Colours come from labels, structural annotations included. Layout, stacking and
the font are CSS custom properties.

Set on the viewer's root element (inline, with these defaults). Override them
with the `style` prop:

| Property | Default | Used for |
|---|---|---|
| `--rca-font-family` | OpenContracts' system font stack | label chips |
| `--rca-z-annotation` | `2` | annotation boxes (PDF) |
| `--rca-z-highlight` | `auto` | highlight boxes (PDF) |
| `--rca-z-pending` | `2` | the pending selection (PDF) |
| `--rca-z-menu` | `9999` | the `renderSelectionMenu` host, which is portalled to the body of the viewer's document |

Not set on the root; each is read as `var(--rca-…, default)`, so set it with
`style`, `className` or on any ancestor:

| Property | Default | Used for |
|---|---|---|
| `--rca-z-native-links` | `2` | the layer of links embedded in the PDF |
| `--rca-z-relation-badge` | `1` | SOURCE / TARGET badges (PDF) |
| `--rca-relation-badge-font-size` | `0.75rem` | the badge tooltip (PDF) |
| `--rca-label-font-weight` | `bold` | the label bar of annotations and highlights (PDF) |
| `--rca-label-font-size` | `12px` (PDF), `0.65em` (DOCX chip) | label bar / chip |
| `--rca-z-label-chip` | `10` | the DOCX label chip |

## Adding a format

A format is a component rendered inside `AnnotatorShell` (from `…/core`), which
owns the per-instance state, the common props, the slots and the format-agnostic
half of the handle. The format registers a `FormatDriver` with
`useRegisterFormatDriver`:

- `kind`: `"token"` or `"span"`, the annotation kind it draws.
- `getPageCount()`, `getVisiblePageRange()`, `getText()`, `findText(query, opts)`,
  `scrollToPage(pageIndex, behavior)`.
- `resolveFitWidth()`: the zoom that fits the page width, or `null` until it can
  be measured (call `useNotifyFitWidthChanged()` when it may have changed).
- `canDraw(target)`: whether it knows the id and can draw it now (call
  `useNotifyDrawabilityChanged()` when the answer may change). Read the
  annotations and highlights with `useReadDocumentData()` when it is called: it
  can be asked in the commit that supplies the target, before a render shows it.

It reports loading through `useSetDocumentStatus` (the shell fires
`onDocumentLoad` / `onError` and renders the loading and error slots from it),
carries out scroll requests with `useScrollRequest` (`request`, then
`complete(seq, ok)`), and paints with the hooks `core` exports for it:
`useAllAnnotations`, `useVisibleAnnotations`, `useHighlights`,
`useSelectedAnnotationIds`, `useDisplaySettings`, `usePendingSelection`,
`useCompleteSelection`, `useRootElement` and the geometry helpers. PDF and DOCX
are built on exactly this contract; `src/docx/DocxAnnotator.tsx` is the shorter
reference implementation. The skeleton below shows the contract (it draws no
annotations):

```tsx
import {
  AnnotatorShell,
  useReadDocumentData,
  useRegisterFormatDriver,
  useScrollRequest,
  useSetDocumentStatus,
} from "@os-legal/react-contract-annotate/core";
import type {
  AnnotatorCommonProps,
  AnnotatorHandle,
} from "@os-legal/react-contract-annotate/core";
import { forwardRef, useEffect } from "react";
import type { ForwardedRef } from "react";

export interface PlainTextAnnotatorProps extends AnnotatorCommonProps {
  text: string;
}

function PlainTextFormat({ text }: { text: string }) {
  const setStatus = useSetDocumentStatus();
  const readData = useReadDocumentData();
  const { request, complete } = useScrollRequest();

  // Tell the shell the document is shown (it fires `onDocumentLoad` and
  // renders the loading and error slots from the status).
  useEffect(() => setStatus({ state: "ready" }), [setStatus]);

  // Answer the format half of the handle. `canDraw` reads the data when it is
  // asked: a jump can come in the commit that supplies its target.
  useRegisterFormatDriver({
    kind: "span",
    getPageCount: () => null,
    getVisiblePageRange: () => null,
    getText: () => text,
    findText: () => [],
    scrollToPage: () => false,
    resolveFitWidth: () => 1,
    canDraw: (target) =>
      target.kind === "annotation" &&
      readData().annotations.some((a) => a.id === target.id),
  });

  // Carry out the scroll request the shell raised, then report the outcome.
  useEffect(() => {
    if (!request) return;
    const scrolled = false; // scroll to `request.target` here
    complete(request.seq, scrolled);
  }, [request, complete]);

  return <pre>{text}</pre>;
}

export const PlainTextAnnotator = forwardRef(function PlainTextAnnotator(
  { text, ...common }: PlainTextAnnotatorProps,
  ref: ForwardedRef<AnnotatorHandle>
) {
  return (
    <AnnotatorShell common={common} handleRef={ref}>
      <PlainTextFormat text={text} />
    </AnnotatorShell>
  );
});
```

## Development

```bash
yarn install            # Yarn 4 (corepack)
yarn lint:imports       # import and DOM-access rules of src/
yarn typecheck
yarn test               # unit tests (Vitest, jsdom)
yarn test:ct            # component tests (Playwright, real Chromium)
yarn build              # tsup: four entry points in dist/
yarn check:dist         # entry points stay isolated from each other's engines

# the demo: its own Yarn project, linked to the build above
yarn build && yarn --cwd examples/demo install && yarn --cwd examples/demo dev
```

**Releasing.** Set `version` in `package.json`, merge, and publish a GitHub
release tagged `v<version>`: `.github/workflows/publish.yml` builds, tests and
stages that version on npm. It refuses a tag that does not match the version.
A staged version is not installable until a maintainer approves it on npmjs.com
(Staged Packages) with their second factor; the workflow holds no npm token and
cannot publish by itself.

The demo is published to GitHub Pages from `main` by `.github/workflows/pages.yml`;
`examples/demo/README.md` says where its documents come from and how its data is
made.

**Parity with OpenContracts.** `fixtures/parity/eton.json` holds the box and
token rectangles OpenContracts' own renderer (`SelectionBoundary` /
`SelectionTokenGroup`, commit `98286cabf`) produces for four annotations of the
eton fixture at zoom 1 and 1.5. `src/pdf/__tests__/parity.test.tsx` checks the
library draws the same pixels. To recapture the reference, copy
`scripts/parity/capture.test.tsx` into an OpenContracts checkout at that commit
and run it as its header describes; never edit the fixture by hand.

## Acknowledgements

Extracted from [OpenContracts](https://github.com/Open-Source-Legal/OpenContracts)
(`frontend/src/components/annotator/`), whose rendering code and geometry it
carries over. The token-based PDF annotation format descends from the
[PAWLS](https://github.com/allenai/pawls) project of the Allen Institute for AI.

## License

MIT
