# react-contract-annotate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract OpenContracts' PDF and DOCX viewer/annotator into a standalone, control-free React library driven by props, callbacks, render slots and a ref handle.

**Architecture:** Per-format components (`PdfAnnotator`, `DocxAnnotator`) built on one shared shell that owns a private Jotai store per instance, the controlled/uncontrolled bridge, the pending-selection logic, explicit scroll requests and the format-agnostic half of the handle. A thin lazy `DocumentAnnotator` dispatches by format. Rendering code is ported from OpenContracts with app couplings (Apollo, router, corpus/chat state, built-in menus) cut out.

**Tech Stack:** TypeScript, React 18, Jotai 3, styled-components 6, pdfjs-dist 6 (`legacy/build`), docxodus 12.4.1, DOMPurify, tsup, Vitest + jsdom + Testing Library, Playwright component testing, Yarn 4 (corepack).

**Spec:** `docs/superpowers/specs/2026-11-24-react-contract-annotate-design.md` — read it before any task; this plan does not repeat its prop and handle listings.

## Global Constraints

- Port source: OpenContracts at commit `98286cabf`, checked out as a detached worktree at `../oc-src` (Task 1 creates it). Paths below written `OC:` are relative to `../oc-src/frontend/src/`. Never port from another branch.
- No imports of `@apollo/client`, `react-router-dom`, `lodash`, `uuid`, `lucide-react`, `semantic-ui-react`, `@os-legal/ui`, `axios`, `react-toastify` anywhere in `src/`.
- No module-level mutable state; no Jotai default store (every `useAtom*` runs under the instance `<Provider store>`); no `document.querySelector` / `getElementById` in `src/` — query from the instance root element.
- `src/core/**` and `src/pdf/**` must not import `docxodus` or `dompurify`; `src/core/**` and `src/docx/**` must not import `pdfjs-dist`.
- pdf.js runtime imports come only from `pdfjs-dist/legacy/build/pdf.mjs`; types from `pdfjs-dist/types/src/display/api`.
- Package `@os-legal/react-contract-annotate`, ESM only, MIT. Peers: `react >=18`, `react-dom >=18`, `styled-components ^6`; optional peers `pdfjs-dist ^6.5.438`, `docxodus ~12.4.1`. Dependencies: `jotai ^3.0.1`, `dompurify ^3.4.18`.
- Public API takes plain JSON only; no class instances cross the boundary.
- Nothing is rendered beyond the document, annotations and highlights unless a render slot is supplied.
- Commit messages and PR text never credit an AI tool.
- All work happens on branch `initial-extraction`; the GitHub repo is private; nothing is published to npm.
- Component tests always run with `--reporter=list`. In `ct-tests/*.ct.tsx`, import wrapper components in their own `import` statement, separate from helpers/constants (Playwright CT only rewrites statements whose specifiers are all components).

## Review Focus

1. **Host re-creates `annotations` / callbacks every render** (inline literals). Expected: no document reload, no scroll, no render loop. → Task 4.
2. **`source` changes or the component unmounts mid-load** (also React StrictMode double-mount). Expected: the earlier load is cancelled, its pdf.js document destroyed, no stale pages, selection and pending selection reset. → Task 6.
3. **Container has zero width at mount** (hidden tab) and is shown later. Expected: fit-to-width is computed once a width exists; zoom is never 0, `NaN` or `Infinity`. → Task 6.
4. **Annotation data that does not fit the document**: token index past the end of a page, page index past the last page, span offsets past the text. Expected: that annotation (or that page of it) is skipped; everything else renders. → Tasks 7 and 10.
5. **PDF with no PAWLs, or PAWLs covering fewer pages than the PDF.** Expected: pages render, bounds-only annotations render, text selection is off on token-less pages, no crash. → Task 6 and Task 9.

---

## File Structure

```
package.json  tsconfig.json  tsup.config.ts  vitest.config.ts  playwright-ct.config.ts
.github/workflows/ci.yml     LICENSE  README.md  .gitignore  .yarnrc.yml
scripts/make-fixtures.mjs    scripts/check-dist.mjs    scripts/parity/capture.test.tsx
fixtures/eton/{eton-agreement.pdf,pawls.json,annotations.json,relations.json}
fixtures/usc/usc-title-1.pdf
fixtures/docx/{test.docx,text.txt,annotations.json}
fixtures/parity/eton.json
playwright/{index.html,index.tsx}
ct-tests/helpers/{fixtures.ts,docxodusWasm.ts,geometry.ts}
ct-tests/wrappers/{PdfHarness.tsx,DocxHarness.tsx,DispatcherHarness.tsx}
ct-tests/*.ct.tsx
examples/demo/                         (Vite app, Task 12)
src/
  index.ts  DocumentAnnotator.tsx
  core/
    index.ts
    types.ts               public types (spec "Data model", "Common props", "The handle")
    constants.ts           ported constants subset
    geometry/{transform.ts,compactAnnotationJson.ts,compactPawls.ts,colorUtils.ts,pdfZoom.ts,layout.ts}
    normalize.ts           public JSON -> internal annotation union
    highlights.ts          highlight helpers (page set, span check)
    state/{atoms.ts,AnnotatorProvider.tsx,controllable.ts,visibility.ts}
    scroll.ts              scroll request atom + hooks
    pending.ts             pending selection + three outcomes
    format.ts              FormatDriver contract
    AnnotatorShell.tsx     provider, prop sync, handle, root element, slots
    slots/SelectionMenuHost.tsx
    LabelChip.tsx
    links.ts               useOpenLink
    devWarn.ts
    fromOpenContractsExport.ts
  pdf/
    index.ts  PdfAnnotator.tsx  configurePdfWorker.ts  loader.ts
    PDFPageInfo.ts  PdfPageRenderer.ts  PdfViewport.tsx  PdfPage.tsx
    AnnotationBox.tsx  SelectionBoundary.tsx  TokenGroup.tsx  effects.ts
    HighlightOverlay.tsx  NativeLinkLayer.tsx  SelectionLayer.tsx  dragState.ts  textSearch.ts
  docx/
    index.ts  DocxAnnotator.tsx  DocxView.tsx  projection.ts  docxOffsetUtils.ts
```

Unit tests sit beside the code in `__tests__/`.

---

### Task 1: Repository, toolchain, source snapshot, fixtures

**Files:**
- Create: everything in the first three lines of the tree above, `scripts/make-fixtures.mjs`, `fixtures/**`, `playwright/**`, `ct-tests/helpers/fixtures.ts`, `src/core/index.ts`, `src/core/constants.ts`, `src/core/__tests__/constants.test.ts`

**Interfaces:**
- Produces: yarn scripts `build`, `typecheck`, `test` (vitest run), `test:ct` (playwright, `--reporter=list`), `lint:imports`; worktree `../oc-src`; fixtures; `serveFixtures(page: Page): Promise<void>` in `ct-tests/helpers/fixtures.ts` which routes `**/fixtures/**` to files under `fixtures/`.
- Produces fixture ids used by every later CT task (in `fixtures/eton/annotations.json`): `a-title` (page 0, tokens 0–1), `a-link` (page 0, tokens 5–7, label text `OC_URL`, `linkUrl: "https://example.com/terms"`), `a-structural` (page 1, tokens 0–40, `structural: true`), `a-compact` (page 2, tokens 30–45, compact v2 json), `a-multi` (last 12 tokens of page 3 + first 12 of page 4), `a-far` (page 17, tokens 10–24), `a-bad-token` (page 0, tokens `[0, 999999]`), `a-bad-page` (page 500). Labels: `l-exhibit` "Exhibit" `#e11d48`, `l-clause` "Clause" `#2563eb`, `l-para` "Paragraph" `#64748b`, `l-url` "OC_URL" (colour = `OC_URL_LABEL_COLOR`). `fixtures/eton/relations.json`: `[{ id: "r-1", label: {id:"l-ref", text:"References"}, sourceIds:["a-title"], targetIds:["a-far"] }]`.

- [ ] **Step 1: Create the branch and the source worktree**

```bash
cd /home/jman/Code/react-contract-annotate && git checkout -b initial-extraction
git -C /home/jman/Code/OpenContracts fetch origin main
git -C /home/jman/Code/OpenContracts worktree add --detach /home/jman/Code/oc-src 98286cabf
```
Expected: `/home/jman/Code/oc-src/frontend/src/components/annotator/renderers/pdf/PDF.tsx` exists and contains `page.render({`.

- [ ] **Step 2: Write `package.json`, `tsconfig.json`, `.yarnrc.yml` (`nodeLinker: node-modules`), `.gitignore`, `LICENSE` (MIT, "Copyright (c) 2026 John Scrudato IV")**

`package.json`: `"name": "@os-legal/react-contract-annotate"`, `"version": "0.1.0"`, `"private": true` (removed only at publish time), `"type": "module"`, `"packageManager": "yarn@4.13.0"`, `"sideEffects": false`, `"files": ["dist"]`, and
```json
"exports": {
  ".":      { "types": "./dist/index.d.ts",      "import": "./dist/index.js" },
  "./pdf":  { "types": "./dist/pdf/index.d.ts",  "import": "./dist/pdf/index.js" },
  "./docx": { "types": "./dist/docx/index.d.ts", "import": "./dist/docx/index.js" },
  "./core": { "types": "./dist/core/index.d.ts", "import": "./dist/core/index.js" }
}
```
Peers / optional peers / dependencies exactly as in Global Constraints (`peerDependenciesMeta` marks `pdfjs-dist` and `docxodus` optional). Dev deps: `typescript ^5.5`, `tsup ^8`, `vitest ^5`, `jsdom ^26`, `@testing-library/react 15.0.7`, `@playwright/experimental-ct-react 1.62.1`, `@playwright/test 1.62.1`, `@vitejs/plugin-react`, `react`/`react-dom` 18, `@types/react`/`@types/react-dom` 18, `styled-components ^6.6.0`, `pdfjs-dist ^6.5.438`, `docxodus 12.4.1`.

- [ ] **Step 3: Write `tsup.config.ts`, `vitest.config.ts`, `playwright-ct.config.ts`, `playwright/index.html`, `playwright/index.tsx`**

tsup: `entry: { index: "src/index.ts", "pdf/index": "src/pdf/index.ts", "docx/index": "src/docx/index.ts", "core/index": "src/core/index.ts" }`, `format: ["esm"]`, `splitting: true`, `dts: true`, `clean: true`, `external: ["react","react-dom","react/jsx-runtime","styled-components","pdfjs-dist","docxodus","docxodus/react"]` plus a regex external for `^pdfjs-dist/`. Vitest: `environment: "jsdom"`, `globals: true`, `include: ["src/**/__tests__/**/*.test.{ts,tsx}"]`. Playwright CT: `testDir: "./ct-tests"`, `testMatch: "*.ct.tsx"`, `reporter: "list"`, Desktop Chrome, viewport 1280×900, `timeout: 60000`, `ctViteConfig.optimizeDeps.exclude: ["docxodus"]`.

- [ ] **Step 4: Copy fixtures and write `scripts/make-fixtures.mjs`**

Copy `oc-src/frontend/tests/fixtures/{eton-agreement.pdf,usc-title-1.pdf,test.docx}`; copy `oc-src/opencontractserver/tests/fixtures/EtonPharmaceuticalsInc_20191114_10-Q_EX-10_1_11893941_EX-10_1_Development_Agreement_ZrZJLLv.json` to `fixtures/eton/pawls.json`. From `oc-src/frontend/tests/DocxAnnotatorTestWrapper.tsx` take `sampleDocText` → `fixtures/docx/text.txt` and its sample annotations → `fixtures/docx/annotations.json` (public `Annotation` shape, ids `d-1`, `d-2`, …, plus one `d-bad-span` with `{ start: 10000000, end: 10000010 }`).
The script reads `pawls.json` and writes `annotations.json` / `relations.json` with the ids above: v1 json per page is `{ bounds: spanning box of the tokens (left=min x, top=min y, right=max x+width, bottom=max y+height), tokensJsons: [{pageIndex, tokenIndex}], rawText: token texts joined by " " }`; `a-compact` uses `{ v: 2, p: { "2": { b: [top,left,right,bottom], t: "30-45" } } }`. `a-bad-token` takes its bounds from token 0 only; `a-bad-page` is `{ "500": { bounds: {top:0,left:0,right:10,bottom:10}, tokensJsons: [{pageIndex:500, tokenIndex:0}], rawText: "" } }` with `page: 500`. The script throws if any other referenced page has too few tokens.

Run: `node scripts/make-fixtures.mjs` → Expected: prints `8 annotations, 1 relation`.

- [ ] **Step 5: Write the failing constants test, then `src/core/constants.ts`**

```ts
// src/core/__tests__/constants.test.ts
import * as C from "../constants";
test("ported values match OpenContracts", () => {
  expect(C.ZOOM_MIN).toBe(0.5);
  expect(C.ZOOM_MAX).toBe(4);
  expect(C.FIT_WIDTH_MARGIN).toBe(16);
  expect(C.PAGE_SPANNING_TOKEN_THRESHOLD).toBe(0.9);
  expect(C.OC_URL_LABEL).toBe("OC_URL");
});
test("library additions", () => {
  expect(C.ZOOM_STEP).toBe(0.1);
  expect(C.SCROLL_SETTLE_TIMEOUT_MS).toBe(5000);
});
```
Copy, value for value, from `OC:assets/configurations/constants.ts`: `ANNOTATION_BOUNDARY_RADIUS ANNOTATION_TOKEN_RADIUS APPROVED_RGB BOUNDARY_OPACITY_SELECTED BOUNDARY_OPACITY_UNSELECTED BOUNDARY_SHADOW_SELECTED BOUNDARY_SHADOW_UNSELECTED COMPACT_JSON_MAX_RANGE_SPAN COMPACT_JSON_MAX_TOTAL_TOKENS FIT_WIDTH_MARGIN OC_URL_LABEL OC_URL_LABEL_COLOR PAGE_SPANNING_TOKEN_THRESHOLD PAWLS_COORDINATE_EPSILON REJECTED_RGB TEXT_BLOCK_HIGHLIGHT_COLOR TOKEN_EXPANSION_PX TOKEN_OPACITY_HIGH TOKEN_OPACITY_LOW TOKEN_SHADOW_BLUR TOKEN_SHADOW_SPREAD ZOOM_MAX ZOOM_MIN Z_INDEX` (only the `Z_INDEX` keys the ported files use). Add `ZOOM_STEP = 0.1`, `SCROLL_SETTLE_TIMEOUT_MS = 5000`, `PAGE_GAP_PX = 32` (the literal `+ 32` in `OC:…/pdf/PDF.tsx`), `PAGE_OVERSCAN = 2`, `LONG_PRESS_MS = 500`, `TOUCH_MOVE_THRESHOLD_PX = 10`.

- [ ] **Step 6: Add `lint:imports` and CI**

`lint:imports` is a node script (`scripts/check-imports.mjs`) that greps `src/` and exits 1 on any banned import or cross-engine import from Global Constraints, and on `document.querySelector|getElementById` in `src/`. `.github/workflows/ci.yml`: on push and PR — corepack enable, `yarn install --immutable`, `yarn lint:imports`, `yarn typecheck`, `yarn test`, `npx playwright install --with-deps chromium`, `yarn test:ct`, `yarn build`.

- [ ] **Step 7: Verify**

Run: `corepack enable && yarn install && yarn typecheck && yarn test && yarn lint:imports && yarn build`
Expected: all exit 0; `dist/core/index.js` exists.

- [ ] **Step 8: Create the private repo, commit, push**

```bash
git add -A && git commit -m "Scaffold toolchain, fixtures and ported constants"
gh repo create Open-Source-Legal/react-contract-annotate --private --source=. --remote=origin \
  --description "Control-free React viewer/annotator for OpenContracts annotations on PDF and DOCX"
git push -u origin main initial-extraction
```
Expected: `gh repo view Open-Source-Legal/react-contract-annotate --json visibility` → `PRIVATE`.

---

### Task 2: Public types, geometry utilities, annotation normalisation

**Files:**
- Create: `src/core/types.ts`, `src/core/geometry/*.ts`, `src/core/normalize.ts`, `src/core/highlights.ts`, `src/core/devWarn.ts`
- Test: `src/core/geometry/__tests__/*.test.ts` (ported), `src/core/__tests__/normalize.test.ts`, `src/core/__tests__/highlights.test.ts`

**Interfaces:**
- Produces (types.ts): every type in the spec sections "Data model", "Common props", "The handle" and "Format-specific inputs" with those exact names, plus `BoundingBox`, `TokenId`, `SinglePageAnnotationJson`, `MultipageAnnotationJson`, `SpanAnnotationJson`, `PawlsToken` (= `OC:components/types.ts` `Token`), `PawlsPage`, `CompactPawls`, `PawlsInput = PawlsPage[] | CompactPawls`, `LabelDisplay`, `ChangeInfo = { source: "user" | "api" }`, `AnnotationDraft`, `PendingSelection = AnnotationDraft & { anchor: { x: number; y: number } }`, `PendingActions = { pending: PendingSelection; anchor: {x:number;y:number}; commit(label?: AnnotationLabel): void; clear(): void; copyText(): Promise<boolean> }`, `SelectionMenuContext = PendingActions`.
- Produces (normalize.ts):
  ```ts
  interface InternalBase { id: string; annotationLabel: AnnotationLabel; rawText: string;
    structural: boolean; approved: boolean; rejected: boolean; linkUrl: string | null; source: Annotation }
  interface TokenAnnotation extends InternalBase { kind: "token"; page: number; json: MultipageAnnotationJson }
  interface SpanAnnotation  extends InternalBase { kind: "span";  json: SpanAnnotationJson }
  type InternalAnnotation = TokenAnnotation | SpanAnnotation;
  function normalizeAnnotation(a: Annotation): InternalAnnotation;
  function normalizeAnnotations(list: Annotation[]): InternalAnnotation[];   // per-object WeakMap cache
  function annotationPages(a: InternalAnnotation): number[];                 // sorted page indices; [] for span
  ```
- Produces (highlights.ts): `highlightPages(h: Highlight): number[]`, `isSpanHighlight(h): boolean`.
- Produces (geometry): same exported names as the OC files — `scaled`, `normalizeBounds`, `doOverlap`, `spanningBound`, `getContrastColor`, `hexToRgb`, `normalizeTokensToPdfViewport`, `resolvePageTokens` (transform.ts); `expandAnnotationJson`, `isSpanFormat`, `iterPageAnnotations`, `CompactAnnotationJson` (compactAnnotationJson.ts); `expandPawlsPages`, `isCompactPawlsFormat` (compactPawls.ts); `computeFitToWidthZoom` (pdfZoom.ts); `clampMenuPosition` (layout.ts); everything `SelectionBoundary`/`ResultBoundary` import from `colorUtils`.
- Produces (devWarn.ts): `devWarnOnce(key: string, message: string): void` — no-op when `process.env.NODE_ENV === "production"`; the seen-set lives on the instance store, not at module level (take the store as first argument: `devWarnOnce(store, key, message)`).

- [ ] **Step 1: Port the geometry test suites first**

Copy `OC:utils/__tests__/{transform.normalizeTokens,compactAnnotationJson,compactPawls,colorUtils,pdfZoom,layout}.test.ts` into `src/core/geometry/__tests__/`, fixing import paths only. Do not port `transform.permissions.test.ts`.

Run: `yarn test src/core/geometry` → Expected: FAIL (modules not found).

- [ ] **Step 2: Port the geometry modules**

Copy the six OC utils. In `transform.ts` keep only the functions listed above (drop `getPermissions` and everything else GraphQL/permission related). Replace constant imports with `../constants`; type imports with `../types`.

Run: `yarn test src/core/geometry` → Expected: PASS.

- [ ] **Step 3: Write `types.ts`** from the spec, with one addition: `PdfAnnotatorProps.pawls?: PawlsInput | null`.

- [ ] **Step 4: Write the failing normalisation tests**

```ts
// src/core/__tests__/normalize.test.ts
import anns from "../../../fixtures/eton/annotations.json";
const byId = (id: string) => anns.find((a) => a.id === id)!;

test("v1 token json is kept and typed as token", () => {
  const n = normalizeAnnotation(byId("a-title"));
  expect(n.kind).toBe("token");
  expect(annotationPages(n)).toEqual([0]);
});
test("compact v2 json expands to v1", () => {
  const n = normalizeAnnotation(byId("a-compact")) as TokenAnnotation;
  expect(n.json[2].tokensJsons).toHaveLength(16);
  expect(n.json[2].tokensJsons[0]).toEqual({ pageIndex: 2, tokenIndex: 30 });
});
test("multipage annotation reports both pages", () => {
  expect(annotationPages(normalizeAnnotation(byId("a-multi")))).toEqual([3, 4]);
});
test("span json is typed as span", () => {
  const n = normalizeAnnotation({ id: "s", annotationLabel: { id: "l", text: "L" }, json: { start: 3, end: 9 } });
  expect(n).toMatchObject({ kind: "span", structural: false, approved: false, rejected: false, linkUrl: null, rawText: "" });
});
test("same input object returns the same normalised object", () => {
  const a = byId("a-title");
  expect(normalizeAnnotations([a])[0]).toBe(normalizeAnnotations([a])[0]);
});
test("source keeps the caller's object for callbacks", () => {
  const a = byId("a-title");
  expect(normalizeAnnotation(a).source).toBe(a);
});
```
`highlights.test.ts`: `highlightPages({id:"h", target:{kind:"tokens", tokensByPage:{4:[1], 2:[0]}}})` → `[2,4]`; `kind:"bounds"` with pages 7 → `[7]`; `kind:"span"` → `[]`.

Run: `yarn test src/core/__tests__` → Expected: FAIL.

- [ ] **Step 5: Implement `normalize.ts`, `highlights.ts`, `devWarn.ts`**

`TokenAnnotation.page` = `a.page ?? Math.min(...annotationPages)`.

Run: `yarn test` → Expected: PASS. `yarn typecheck` → 0 errors.

- [ ] **Step 6: Commit** — `git commit -m "Add public types, geometry utilities and annotation normalisation"`

---

### Task 3: Per-instance store, controllable bridge, visibility filter

**Files:**
- Create: `src/core/state/atoms.ts`, `AnnotatorProvider.tsx`, `controllable.ts`, `visibility.ts`
- Test: `src/core/state/__tests__/{controllable,visibility,isolation}.test.tsx`

**Interfaces:**
- Produces (atoms.ts): `annotationsAtom: InternalAnnotation[]`, `relationsAtom: Relation[]`, `highlightsAtom: Highlight[]`, `selectedAnnotationIdsAtom: string[]`, `selectedRelationIdsAtom: string[]`, `zoomAtom: number` (initial 1), `zoomInitialisedAtom: boolean`, `activeHighlightIdAtom: string | null`, `hoveredAnnotationIdAtom: string | null`, `displaySettingsAtom: DisplaySettings`, `editingAtom: { readOnly: boolean; activeLabel: AnnotationLabel | null }`, `rootElementAtom: HTMLElement | null`, `documentStatusAtom: { state: "loading" | "ready" | "error"; progress: number | null; error: Error | null }`, `instanceIdAtom: string`.
  `DisplaySettings = { showStructural: boolean; showStructuralRelationships: boolean; showSelectedOnly: boolean; showBoundingBoxes: boolean; labelDisplay: LabelDisplay; visibleLabelIds: string[] | null }`, `DEFAULT_DISPLAY_SETTINGS` = spec defaults.
- Produces (AnnotatorProvider.tsx): `AnnotatorProvider({ children })` — `createStore()` once per mount, sets `instanceIdAtom` from `useId()`.
- Produces (controllable.ts):
  ```ts
  type ControllableKey = "selection" | "zoom" | "activeHighlight";
  function useControllable<T>(key: ControllableKey, opts: { value: T | undefined; defaultValue: T;
      onChange?: (next: T, info: ChangeInfo) => void; equals?: (a: T, b: T) => boolean }): void;
  function useSetControllable<T>(key: ControllableKey): (next: T, info: ChangeInfo) => void;
  function useLastUserValue<T>(key: ControllableKey): { current: T | undefined };
  ```
  `selection` ↔ `selectedAnnotationIdsAtom`, `zoom` ↔ `zoomAtom`, `activeHighlight` ↔ `activeHighlightIdAtom`.
- Produces (visibility.ts): `selectVisibleAnnotations(input: { annotations; relations; selectedAnnotationIds; selectedRelationIds; settings: DisplaySettings }): InternalAnnotation[]`, `useVisibleAnnotations(): InternalAnnotation[]`.

- [ ] **Step 1: Write the failing controllable tests** (render a probe component under `AnnotatorProvider` with Testing Library)

```ts
test("uncontrolled: setter updates the atom and notifies", ...
  // useControllable("zoom", { value: undefined, defaultValue: 1.25, onChange })
  // atom starts 1.25; set(2, {source:"user"}) -> atom 2, onChange(2, {source:"user"}) once
test("controlled: setter notifies but does not change the atom", ...
  // value: 1.5 -> atom 1.5; set(2, …) -> atom still 1.5, onChange(2, …) once
test("controlled: a new value prop is written into the atom", ...   // rerender value 3 -> atom 3
test("controlled: an equal value by `equals` does not rewrite the atom", ...
  // key "selection", equals = shallow array equality; rerender with a new ["a"] array -> atom keeps the old array reference
test("defaultValue is applied once; later defaultValue changes are ignored", ...
test("useLastUserValue records only source:'user' writes", ...
```
Run: `yarn test src/core/state` → Expected: FAIL.

- [ ] **Step 2: Implement `atoms.ts`, `AnnotatorProvider.tsx`, `controllable.ts`**

Callbacks are read through a ref so an inline `onChange` never re-runs effects. Controlled-ness per key is stored in a store atom so `useSetControllable` (called from renderers and the handle) can read it.

Run: `yarn test src/core/state/__tests__/controllable.test.tsx` → Expected: PASS.

- [ ] **Step 3: Port the visibility tests, then the logic**

Port `OC:components/annotator/hooks/__tests__/useVisibleAnnotations.test.tsx` as tests of the pure `selectVisibleAnnotations` (same cases, inputs passed as arguments instead of mocked hooks), and add:
```ts
test("visibleLabelIds [] and null both mean no filter", ...
test("a selected annotation is visible even when its label is filtered out", ...
test("endpoints of a relation in selectedRelationIds are visible when structural is hidden", ...
```
Port the predicate from `OC:…/hooks/useVisibleAnnotations.ts` unchanged; `selectedRelations` becomes the relations whose id is in `selectedRelationIds`.

Run: `yarn test src/core/state` → Expected: PASS.

- [ ] **Step 4: Isolation test**

```ts
test("two providers do not share state", ...
  // mount two AnnotatorProviders, set zoom to 2 in the first -> second still reads 1
```
Run → PASS.

- [ ] **Step 5: Commit** — `git commit -m "Add per-instance store, controllable bridge and visibility filter"`

---

### Task 4: Shell, handle, scroll requests, format contract

**Files:**
- Create: `src/core/format.ts`, `src/core/scroll.ts`, `src/core/AnnotatorShell.tsx`
- Modify: `src/core/index.ts` (export public surface)
- Test: `src/core/__tests__/{shell.handle,shell.scroll,shell.rerender}.test.tsx` with a fake format in `src/core/__tests__/fakeFormat.tsx`

**Interfaces:**
- Produces (format.ts):
  ```ts
  interface FormatDriver {
    kind: "token" | "span";
    getPageCount(): number | null;
    getVisiblePageRange(): [number, number] | null;
    getText(): string;
    findText(query: string, opts?: { caseSensitive?: boolean }): Highlight[];
    scrollToPage(pageIndex: number, behavior: ScrollBehavior): boolean;
    resolveFitWidth(): number | null;                 // null until measurable
    canDraw(target: ScrollTarget): boolean;           // id known and drawable by this format
  }
  function useRegisterFormatDriver(driver: FormatDriver): void;
  function useNotifyFitWidthChanged(): () => void;   // a format calls this when resolveFitWidth() may now differ
  ```
- Produces (scroll.ts):
  ```ts
  type ScrollTarget = { kind: "annotation"; id: string } | { kind: "highlight"; id: string };
  interface ScrollRequest { seq: number; target: ScrollTarget; behavior: ScrollBehavior; bounded: boolean }
  function useRequestScroll(): (target: ScrollTarget, opts?: { behavior?: ScrollBehavior; bounded?: boolean }) => Promise<boolean>;
  function useScrollRequest(): { request: ScrollRequest | null; complete(seq: number, ok: boolean): void };
  ```
  A new request settles the previous one with `false`. `bounded: true` requests settle `false` after `SCROLL_SETTLE_TIMEOUT_MS`; unbounded ones (prop-driven) wait until completed or superseded.
- Produces (AnnotatorShell.tsx): `AnnotatorShell<M>(props: { common: AnnotatorCommonProps<M>; handleRef: React.Ref<AnnotatorHandle>; children: React.ReactNode })`. Renders `<div data-rca-root data-rca-instance={id} class=… style=…>` (overflow auto, height 100%, position relative) which is the scroll container and `rootElementAtom`, and defines the theming CSS custom properties with their defaults (`--rca-font-family`, `--rca-z-annotation`, `--rca-z-highlight`, `--rca-z-pending`, `--rca-structural-color`; defaults are the ported constant values); shows `renderLoading(progress)` / `renderError(error)` per `documentStatusAtom` (nothing when the slot is absent); renders children once a driver is registered or always (children own loading).

- [ ] **Step 1: Write the fake format** — a component that registers a driver with `getPageCount: () => 3`, records `scrollToPage` calls, `canDraw` true for ids starting `"a"`/`"h"`, and completes any scroll request it sees on the next tick with `true`.

- [ ] **Step 2: Write the failing handle tests**

```ts
test("getZoom/setZoom/zoomIn/zoomOut, clamped to [0.5, 4], step 0.1", ...
  // defaultZoom 1 -> zoomIn -> 1.1 ; setZoom(9) -> 4 ; setZoom(0.1) -> 0.5
test("setZoom('fit-width') uses driver.resolveFitWidth()", ...       // fake returns 1.37 -> getZoom() 1.37
test("selectAnnotations reports source 'api' and updates uncontrolled state", ...
test("controlled selection: selectAnnotations calls onSelectionChange and getSelectedAnnotationIds still returns the prop", ...
test("clearSelection -> onSelectionChange([], {source:'api'})", ...
test("getPageCount / getVisiblePageRange / getText / findText delegate to the driver", ...
test("scrollToPage delegates and returns the driver's boolean", ...
test("scrollToAnnotation resolves false for an id the driver cannot draw", ...     // id "zzz"
test("scrollToAnnotation(id, {select:true}) selects then resolves true", ...
test("getScrollContainer returns the root element", ...
test("scrollToHighlight(id, {activate:true}) sets the active highlight with source 'api'", ...
test("renderLoading gets documentStatus.progress, renderError gets the error; with no slots the root has no extra children", ...
test("className and style land on the root; a style override of --rca-z-annotation is readable via getComputedStyle", ...
```
Run: `yarn test src/core/__tests__/shell.handle.test.tsx` → Expected: FAIL.

- [ ] **Step 3: Implement `format.ts`, `scroll.ts`, `AnnotatorShell.tsx` (handle + prop sync)**

Prop sync writes `annotations` (through `normalizeAnnotations`), `relations`, `highlights`, display settings, `editingAtom`, `selectedRelationIds` into the store in effects; `useControllable` for selection (shallow array equality), zoom and active highlight. `defaultZoom: "fit-width"` (and the default) is resolved once `driver.resolveFitWidth()` is non-null and `zoomInitialisedAtom` is false; a numeric `zoom`/`defaultZoom` sets `zoomInitialisedAtom` immediately. `useNotifyFitWidthChanged()` bumps a counter atom that this resolution effect depends on.

Run: handle tests → Expected: PASS.

- [ ] **Step 4: Write the failing scroll-rule tests**

```ts
test("selection changed by props raises a scroll request for the first id", ...
test("selection changed by handle.selectAnnotations raises one; {scroll:false} does not", ...
test("user-sourced selection does not raise one, uncontrolled", ...
  // call useSetControllable('selection')(['a1'], {source:'user'}) from a probe
test("user-sourced selection does not raise one when the host echoes it back as a prop", ...
  // controlled: onSelectionChange -> host sets selectedAnnotationIds to a NEW equal array -> no request
test("scrollOnSelect=false suppresses selection-driven requests but not handle.scrollToAnnotation", ...
test("selection present at mount raises one request once documentStatus is 'ready'", ...
test("…and waits for the id to appear in annotations", ...
  // selected ['a9'] not in annotations -> no request; rerender with a9 present -> one request
test("zoom change raises none; new annotations array with same content raises none", ...
test("active highlight changed by props raises a highlight request", ...
test("a newer request settles the older promise false", ...
test("bounded request settles false after 5000 ms when never completed", ...   // fake timers
```
Run → Expected: FAIL.

- [ ] **Step 5: Implement the scroll rules in the shell**

One effect keyed on (selection ids, status, whether the first id is in `annotationsAtom`), comparing against `useLastUserValue("selection")` to skip echoes; same pattern for active highlight.

Run → Expected: PASS.

- [ ] **Step 6: Review Focus 1 — re-render storm test**

```ts
test("inline annotations array and inline callbacks every render cause no loop and no scroll", ...
  // Host component: const [n,setN]=useState(0); renders shell with annotations={[...fixture]} and
  // onSelectionChange={() => {}} inline; setN 20 times.
  // Expect: render count of the fake format <= 25, zero scroll requests, driver registered exactly once.
```
Run → PASS (fix prop sync until it does: compare annotation arrays by element identity before writing the atom).

- [ ] **Step 7: Export the public surface from `src/core/index.ts`** — all public types, `AnnotatorShell`, `useRegisterFormatDriver`, `FormatDriver`, `useVisibleAnnotations`, `useRequestScroll`, `useScrollRequest`, `useSetControllable`, geometry helpers a format author needs (`scaled`, `spanningBound`, `expandAnnotationJson`, `expandPawlsPages`).

Run: `yarn test && yarn typecheck && yarn lint:imports` → all pass.

- [ ] **Step 8: Commit** — `git commit -m "Add annotator shell, handle, scroll requests and format contract"`

---

### Task 5: Pending selection and selection-menu slot

**Files:**
- Create: `src/core/pending.ts`, `src/core/slots/SelectionMenuHost.tsx`
- Modify: `src/core/state/atoms.ts` (add `pendingSelectionAtom: PendingSelection | null`), `src/core/AnnotatorShell.tsx` (mount host, handle methods, Escape)
- Test: `src/core/__tests__/pending.test.tsx`

**Interfaces:**
- Produces: `useCompleteSelection(): (draft: AnnotationDraft, anchor: { x: number; y: number }) => void` — called by a format when the user finishes selecting; `usePendingSelection(): PendingSelection | null`; `usePendingActions(): { commit(label?: AnnotationLabel): void; clear(): void; copyText(): Promise<boolean> }`. Handle gains `getPendingSelection`, `commitPendingSelection`, `clearPendingSelection`.

- [ ] **Step 1: Write the failing tests** (fake format exposes a button that calls `useCompleteSelection` with a fixed draft `{ json: {start:3,end:9}, rawText: "sample", page: 0, annotationLabel: null }` and anchor `{x:100,y:120}`)

```ts
test("onTextSelect always fires first with the pending selection and actions", ...
test("outcome 1: with renderSelectionMenu the slot is rendered, selection stays pending, onCreateAnnotation not called", ...
  // slot receives { pending, anchor: {x:100,y:120}, commit, clear, copyText }
test("outcome 1: slot commit(label) calls onCreateAnnotation with that label and clears pending", ...
test("outcome 2: no slot + activeLabel + not readOnly -> onCreateAnnotation({...draft, annotationLabel: activeLabel}) once, pending null", ...
test("outcome 3: no slot + no activeLabel -> pending stays until handle.clearPendingSelection()", ...
test("outcome 3: readOnly with activeLabel also stays pending and never calls onCreateAnnotation", ...
test("commit with no label and no activeLabel passes annotationLabel: null", ...
test("readOnly: commit is a no-op that leaves the selection pending", ...
test("Escape clears a pending selection", ...
test("a second completed selection replaces the first", ...
test("copyText writes pending.rawText to the clipboard and resolves true; resolves false when clipboard is unavailable", ...
test("nothing is rendered for a pending selection when no slot is given", ...
  // document.body contains no [data-rca-selection-menu]
test("the library never adds the draft to annotations", ...   // annotationsAtom length unchanged after commit
```
Run → Expected: FAIL.

- [ ] **Step 2: Implement**

`SelectionMenuHost` portals `<div data-rca-selection-menu style="position:fixed">` to `document.body`, positioned with `clampMenuPosition`; stops `mousedown`/`touchstart` propagation so clicking the host's menu does not start a new selection. Escape listener is attached to the instance root (`keydown`, root has `tabIndex={-1}`) and to `window` only while a selection is pending.

Run: `yarn test src/core` → Expected: PASS.

- [ ] **Step 3: Commit** — `git commit -m "Add pending selection outcomes and selection menu slot"`

---

### Task 6: PDF loading, virtualised pages, zoom

**Files:**
- Create: `src/pdf/{index.ts,PdfAnnotator.tsx,configurePdfWorker.ts,loader.ts,PDFPageInfo.ts,PdfPageRenderer.ts,PdfViewport.tsx,PdfPage.tsx}`, `ct-tests/wrappers/PdfHarness.tsx`, `ct-tests/helpers/geometry.ts`, `ct-tests/pdf-pages.ct.tsx`
- Modify: `playwright/index.tsx` (call `configurePdfWorker` with `new URL("pdfjs-dist/legacy/build/pdf.worker.mjs", import.meta.url).href`)
- Test: `src/pdf/__tests__/PDFPageInfo.test.ts` (port of `OC:…/types/__tests__/pdf.test.ts`), `src/pdf/__tests__/loader.test.tsx`

**Interfaces:**
- Consumes: `AnnotatorShell`, `useRegisterFormatDriver`, `zoomAtom`, `documentStatusAtom`, `useScrollRequest`, `resolvePageTokens`, `expandPawlsPages`, `computeFitToWidthZoom`.
- Produces: `configurePdfWorker(workerSrc: string): void`; `PdfAnnotator` (forwardRef to `AnnotatorHandle`, props `PdfAnnotatorProps`); `PDFPageInfo` (ported class, same methods; `getAnnotationForBounds`/`getFreeFormAnnotationForBounds` dropped, `getPageAnnotationJson` kept); `pdfPagesAtom: PDFPageInfo[]` in `src/pdf/loader.ts`; `usePdfDocument(source, pawls): void` which fills `pdfPagesAtom` and `documentStatusAtom`; DOM contract for tests: each mounted page is `[data-rca-page="<index>"]` containing one `<canvas>`.
- Produces (`PdfHarness.tsx`): a wrapper taking `{ mode?: "uncontrolled" | "controlled"; annotationIds?: string[]; withPawls?: boolean; fixture?: "eton" | "usc"; props?: Partial<PdfAnnotatorProps> }`, fetching fixtures from `/fixtures/**`, sized 900×700, exposing the handle on `window.__rca` and an event log on `window.__rcaEvents` (array of `[name, ...args]` for every callback). Later tasks extend it; do not create a second PDF harness.

- [ ] **Step 1: Port `PDFPageInfo` tests and class**

Copy `OC:…/types/__tests__/pdf.test.ts` (drop cases for the two removed methods), then `OC:…/types/pdf.ts`. `getPageAnnotationJson` computes `rawText` with the ported `convertAnnotationTokensToText` (from `OC:components/annotator/utils.ts`, moved into `PDFPageInfo.ts`).

Run: `yarn test src/pdf/__tests__/PDFPageInfo.test.ts` → FAIL, then PASS after the port.

- [ ] **Step 2: Write the failing loader tests** (mock `pdfjs-dist/legacy/build/pdf.mjs` `getDocument` with a controllable fake)

```ts
test("status goes loading -> ready and pages are built with normalised tokens", ...
test("progress is reported as 0..100 and null before the first progress event", ...
test("source {document} skips getDocument", ...
test("compact v2 pawls are expanded", ...
test("pawls null: pages have empty token arrays", ...                              // Review Focus 5
test("pawls shorter than the document: later pages have empty token arrays", ...   // Review Focus 5
test("changing source cancels the first load: its pages never appear and destroy() is called on its task", ... // Review Focus 2
test("unmount mid-load calls destroy() and sets no state", ...                     // Review Focus 2
test("StrictMode double mount yields exactly one live document", ...               // Review Focus 2
test("a load failure sets status error and calls onError once", ...
test("a new source object with the same url does not reload", ...
```
Run → Expected: FAIL.

- [ ] **Step 3: Implement `configurePdfWorker.ts` and `loader.ts`**

Loading is keyed on `url` / `data` identity / `document` identity, not on the `source` object. The library never destroys a `PDFDocumentProxy` the host passed in via `{ document }`.

Run → Expected: PASS.

- [ ] **Step 4: Port the viewport and page**

`PdfPageRenderer.ts` ← class `PDFPageRenderer` from `OC:…/pdf/PDF.tsx`. `PdfViewport.tsx` ← the `PDF` component: keep page-height cache, prefix sums, binary-search window, overscan, shared render debounce. Replace `scrollContainerRefAtom` with `rootElementAtom`; replace the three selection/search/chat "keep mounted" inputs with: pages of every selected annotation, pages of the active highlight, pages of the pending scroll request's target, pages touched by the pending selection. Remove the three scroll effects (Task 7/8 re-add them as scroll-request consumers). `PdfPage.tsx` ← `PDFPage`: canvas + render lifecycle + fit-to-width initial zoom only; no layers yet. Drop the dead `resize` listener on the scroll container. The driver's `resolveFitWidth()` returns `computeFitToWidthZoom(page 1 natural width, root clientWidth)` or `null` when `clientWidth` is 0; a `ResizeObserver` on the root calls `useNotifyFitWidthChanged()` until the initial zoom has been resolved.

- [ ] **Step 5: Write the failing component tests**

```ts
// ct-tests/pdf-pages.ct.tsx
test("renders the first pages and virtualises the rest", ...
  // eton: handle.getPageCount() === 23; [data-rca-page] count is between 1 and 6; page 0 canvas has width > 0
test("default zoom fits width", ...
  // canvas width <= 900 - 16 and >= 900 - 16 - 40 ; getZoom() within [0.5, 4]
test("uncontrolled zoom: handle.setZoom(1.5) resizes the canvas and fires onZoomChange(1.5)", ...
test("controlled zoom: handle.zoomIn() fires onZoomChange but canvas width is unchanged until the prop changes", ...
test("scrollToPage(12) mounts page 12 and reports it in getVisiblePageRange()", ...
test("onDocumentLoad fires once with pageCount 23 and non-empty text; onVisiblePagesChange fires on scroll", ...
test("two viewers: zooming the left one does not resize the right one's canvases", ...
test("usc fixture without pawls renders pages", ...                                   // Review Focus 5
test("mounted hidden (display:none) then shown: zoom becomes a finite fit-width value", ...  // Review Focus 3
test("only pages and canvases are rendered: no buttons, inputs or menus in the root", ...
  // root.locator("button, input, select, [role=menu], [role=dialog]") count 0
```
Run: `npx playwright install chromium && yarn test:ct pdf-pages` → Expected: FAIL.

- [ ] **Step 6: Implement `PdfAnnotator.tsx`, the harness and `serveFixtures`; make the tests pass**

`getText()` for now returns token texts joined with spaces page by page (Task 8 replaces it with the search index text).

Run: `yarn test:ct pdf-pages` → Expected: PASS. `yarn test && yarn typecheck && yarn lint:imports` → pass.

- [ ] **Step 7: Commit** — `git commit -m "Add PDF loader, virtualised pages and zoom"`

---

### Task 7: PDF annotation display, clicks, links, scroll-to-annotation

**Files:**
- Create: `src/pdf/{AnnotationBox.tsx,SelectionBoundary.tsx,TokenGroup.tsx,effects.ts,NativeLinkLayer.tsx}`, `src/core/LabelChip.tsx`, `src/core/links.ts`, `ct-tests/pdf-annotations.ct.tsx`
- Modify: `src/pdf/PdfPage.tsx`, `src/pdf/PdfViewport.tsx`, `src/core/index.ts`
- Test: `src/pdf/__tests__/{SelectionBoundary,NativeLinkLayer,AnnotationBox}.test.tsx`

**Interfaces:**
- Consumes: `useVisibleAnnotations`, `useSetControllable("selection")`, `useScrollRequest`, `displaySettingsAtom`, `PDFPageInfo`.
- Produces: DOM contract — annotation box `[data-rca-annotation="<id>"][data-rca-page-part="<pageIndex>"]` with `data-selected`, `data-approved`, `data-rejected`; label chip `[data-rca-label-chip]`; token rects `[data-rca-token]`; relation badge `[data-rca-relation-role="SOURCE"|"TARGET"]`. `LabelChip({ annotation, color, visible, children })` in core. `useOpenLink(): (url: string, source: Annotation | "native") => void` in `src/core/links.ts` (calls `onOpenLink` if given, else `window.open(url, "_blank", "noopener,noreferrer")` for `http:`/`https:` only).

- [ ] **Step 1: Port unit tests** `OC:…/display/components/__tests__/SelectionBoundary.test.tsx` and `OC:…/renderers/pdf/__tests__/NativeLinkLayer.test.tsx`, replacing the mocked atoms with a real `AnnotatorProvider`. Add `AnnotationBox.test.tsx`:

```ts
test("a token index past the end of the page is skipped; the remaining tokens still render", ...  // a-bad-token, Review Focus 4
test("an annotation page that has no bounds renders nothing for that page and does not throw", ...
test("labelDisplay 'hide' renders no chip; 'always' renders it; 'hover' renders it only while hovered or selected", ...
test("renderAnnotationActions output is inside the chip and receives {selected, hovered}", ...
test("no slot: the chip contains only the label text", ...
test("approved / rejected set data attributes and the ported border styling", ...
test("selected relation endpoint shows SOURCE / TARGET badge", ...
```
Run → Expected: FAIL.

- [ ] **Step 2: Port the display components**

`SelectionBoundary.tsx` ← `OC:…/display/components/SelectionBoundary.tsx` (+ `effects.tsx`). `TokenGroup.tsx` ← `SelectionTokenGroup.tsx` + `Tokens.tsx`; replace `lodash/uniqueId` with `useId`. `AnnotationBox.tsx` ← `Selection.tsx` with these removals: auth token, `RadialButtonCloud`, pencil/trash, both modals, all mutation hooks, `useNavigate`. Label text comes from the ported `annotationChipLabel` (`OC:…/utils/urlAnnotation.ts`; port `isUrlAnnotation` and `annotationChipLabel` only). The class `selection_<id>` is replaced by the data attributes above, and every static `id="…"` attribute in the ported components is removed. Hard-coded `Z_INDEX` and font values in the ported styled-components become `var(--rca-…, <ported default>)`. `NativeLinkLayer.tsx` ← OC file, link clicks go through `useOpenLink()`; rendered only when `enableNativeLinks !== false`.

Click model (spec "Clicks keep each format's current model"): Shift/Ctrl/Cmd-click toggles via `useSetControllable("selection")(next, {source:"user"})`; a `linkUrl` annotation opens on plain click; plain press otherwise falls through. `onAnnotationClick(annotation.source, event)` fires from the box's `click` handler for every click whose mouse-down and mouse-up are within 3 px. `onAnnotationHover` fires with `annotation.source` / `null`.

Run: `yarn test src/pdf` → Expected: PASS.

- [ ] **Step 3: Consume scroll requests for annotations**

In `PdfViewport`: for a request `{kind:"annotation"}`, scroll the root to `max(0, cumulative[firstPage] - PAGE_GAP_PX)`. In `PdfPage`: once the page that owns the target has rendered and the box exists under the instance root, set `root.scrollTop`/`scrollLeft` so the box is centred (computed from `getBoundingClientRect` deltas), then `complete(seq, true)`. Retry on animation frames while the request is still current; stop when superseded. `driver.canDraw({kind:"annotation"})` is true when the id is a token annotation whose first page is `< pageCount`.

- [ ] **Step 4: Write the failing component tests**

```ts
// ct-tests/pdf-annotations.ct.tsx — helper boxRelativeToCanvas(page, id, pageIndex) in ct-tests/helpers/geometry.ts
test("a-title box equals json bounds x zoom, at zoom 1 and 1.5 (±1px)", ...
test("token rects of a-title cover tokens 0 and 1 (±1px)", ...
test("a-compact renders 16 token rects on page 2", ...
test("scrollToAnnotation('a-far') resolves true and the box is inside the viewport, vertically centred ±80px", ...
test("scrollToAnnotation('nope') resolves false; scrollToAnnotation('a-bad-page') resolves false", ...   // Review Focus 4
test("a-multi: selecting it keeps pages 3 and 4 mounted and draws a box on each", ...
test("prop-driven selection of a-far scrolls to it; scrollOnSelect=false does not", ...
test("shift-click toggles selection (uncontrolled) and fires onSelectionChange(ids, {source:'user'}) without scrolling", ...
test("controlled selection: shift-click fires the callback and data-selected stays false until the prop changes", ...
test("plain click on a-title fires onAnnotationClick and does not select", ...
test("showStructural=false hides a-structural; true shows it; visibleLabelIds=['l-clause'] hides a-title", ...
test("showSelectedOnly shows only the selected annotation", ...
test("selectedRelationIds=['r-1'] forces both endpoints visible with SOURCE/TARGET badges", ...
test("plain click on a-link calls onOpenLink('https://example.com/terms', annotation); ctrl-click selects instead", ...
test("without onOpenLink a javascript: linkUrl is ignored", ...        // harness prop overrides linkUrl; window.open not called
test("a-bad-token and a-bad-page do not break rendering of the others", ...   // Review Focus 4
test("zoom change with a selection does not move scrollTop to the selection", ...
test("no chrome: root has no button/input/menu/dialog with annotations shown", ...
```
Run: `yarn test:ct pdf-annotations` → Expected: FAIL, then PASS after wiring `AnnotationBox` into `PdfPage`.

- [ ] **Step 5: Commit** — `git commit -m "Add PDF annotation rendering, click model, links and scroll-to-annotation"`

---

### Task 8: PDF highlights, text search, scroll-to-highlight

**Files:**
- Create: `src/pdf/HighlightOverlay.tsx`, `src/pdf/textSearch.ts`, `ct-tests/pdf-highlights.ct.tsx`
- Modify: `src/pdf/PdfPage.tsx`, `src/pdf/PdfViewport.tsx`, `src/pdf/PdfAnnotator.tsx`
- Test: `src/pdf/__tests__/{textSearch,HighlightOverlay}.test.tsx` (ports `OC:…/display/components/__tests__/ResultBoundary.test.tsx`)

**Interfaces:**
- Produces: `buildSearchIndex(pages: PDFPageInfo[]): { text: string; charToToken: Record<number, TokenId> }` (the ported `createTokenStringSearch`); `findTokenMatches(index, query: string, opts?: { caseSensitive?: boolean }): Highlight[]` returning `{ id: "find-<n>", target: { kind: "tokens", tokensByPage } }` in document order; DOM contract `[data-rca-highlight="<id>"][data-active]`.

- [ ] **Step 1: Failing unit tests**

```ts
test("index text is page token texts joined by single spaces", ...
test("findTokenMatches('Exhibit') on page-0 tokens returns tokensByPage {0:[0]} first", ...
test("case-insensitive by default; caseSensitive:true narrows", ...
test("a match spanning a page break yields tokens on both pages", ...
test("empty or whitespace query returns []", ...
test("HighlightOverlay derives bounds from tokens when boundsByPage is absent", ...
test("kind 'bounds' draws the box and no token rects", ...
test("kind 'span' draws nothing and warns once in development", ...
test("a token index past the end of the page is skipped", ...     // Review Focus 4
```
Port the matching logic from `OC:…/hooks/useTextSearch.tsx` (drop lodash debounce and atoms).

Run → FAIL, implement, PASS.

- [ ] **Step 2: Build the overlay** from `ResultBoundary.tsx`, `SearchResult.tsx`, `SelectionTokens.tsx`, `ChatSourceResult.tsx`: one component per highlight per page. Default colour `TEXT_BLOCK_HIGHLIGHT_COLOR`. Every supplied highlight is painted; the active one gets the selected opacity/shadow constants. Consume `{kind:"highlight"}` scroll requests exactly as Task 7 does for annotations. `driver.getText()` / `findText()` now use the search index.

- [ ] **Step 3: Failing component tests**

```ts
test("all supplied highlights on mounted pages are painted", ...
test("activeHighlightId prop change scrolls to it and marks it data-active", ...
test("handle.scrollToHighlight(id, {activate:true}) fires onActiveHighlightChange(id) and resolves true", ...
test("round trip: handle.findText('Agreement') -> pass as highlights -> scrollToHighlight(last.id) lands on a later page", ...
test("highlights and annotations render together; clicking a highlight does not change annotation selection", ...
```
Run: `yarn test:ct pdf-highlights` → FAIL → implement → PASS.

- [ ] **Step 4: Commit** — `git commit -m "Add PDF highlights, text search and scroll-to-highlight"`

---

### Task 9: PDF text selection

**Files:**
- Create: `src/pdf/SelectionLayer.tsx`, `ct-tests/pdf-selection.ct.tsx`
- Create also: `src/pdf/dragState.ts` (`pdfDragAtom: { active: { pageIndex: number; bounds: BoundingBox } | null; regions: Record<number, BoundingBox[]> }`)
- Modify: `src/pdf/PdfPage.tsx`
- Test: `src/pdf/__tests__/SelectionLayer.{documentListeners,readOnly}.test.tsx` (ports of `OC:…/pdf/__tests__/SelectionLayer.documentListeners.test.tsx` and `.permissions.test.tsx`; the `.urlFlow` test is not ported)

**Interfaces:**
- Consumes: `useCompleteSelection`, `usePendingSelection`, `PDFPageInfo.getPageAnnotationJson`, `spanningBound`.
- Produces: pending selection painted as `[data-rca-pending-region]` boxes plus token rects on every mounted page it touches.

- [ ] **Step 1: Port the two unit suites** against the new store-level state (the read-only suite asserts: `readOnly` still allows drag-select and `onTextSelect`, never `onCreateAnnotation`).

Run → FAIL.

- [ ] **Step 2: Port `SelectionLayer.tsx`**

Keep from OC: mouse/touch handlers, document-level mouse-up/move listeners, the `finalizingRef` re-entrancy guard, long-press (`LONG_PRESS_MS`, `TOUCH_MOVE_THRESHOLD_PX`), Shift-to-add-region. Remove: the action menu and its portal, keyboard shortcuts, copy link (`useLocation`, `textBlockEncoding`), URL modal, corpus/permission checks, `SELECTION_MENU_COOLDOWN_MS`. In-progress and accumulated regions live in `pdfDragAtom`, so Shift-drag on a second page adds to the same draft. On mouse-up without Shift: build the draft — `json[page] = pageInfo.getPageAnnotationJson(regions[page])` for each page with ≥1 token, `page` = lowest page index, `rawText` = per-page raw texts joined by `" "`, `annotationLabel: null` — and call `useCompleteSelection()(draft, { x: event.clientX, y: event.clientY })`. A drag that captures zero tokens completes nothing and clears. Mouse-down on a page with no tokens does nothing (Review Focus 5). Starting a new drag clears the current pending selection and (as today) the annotation selection, with `{source:"user"}`.

Run: `yarn test src/pdf` → PASS.

- [ ] **Step 3: Failing component tests** (drag with `page.mouse`, then 500 ms settle; helper `dragOverTokens(page, pageIndex, fromToken, toToken)` in `ct-tests/helpers/geometry.ts` computes coordinates from `pawls.json` × zoom)

```ts
test("drag over tokens 0-1 of page 0 -> onTextSelect pending.rawText 'Exhibit 10.1', tokensJsons [0,1], page 0", ...
test("outcome 2: activeLabel set -> onCreateAnnotation with that label; no pending region left", ...
test("outcome 1: renderSelectionMenu -> menu visible near the mouse-up point; clicking its Apply calls onCreateAnnotation; region clears", ...
test("outcome 3: nothing configured -> region stays; handle.clearPendingSelection() removes it", ...
test("Escape removes a pending region", ...
test("readOnly + activeLabel: selection is reported, nothing is created", ...
test("pending selection survives scrolling its page out and back", ...
test("shift-drag on page 0 then page 1 -> one draft whose json has keys 0 and 1", ...
test("drag over an existing annotation still selects the text under it", ...
test("drag on blank margin produces no onTextSelect", ...
test("usc fixture without pawls: dragging produces no onTextSelect and no error", ...   // Review Focus 5
test("host adds the draft to annotations -> it renders as a normal annotation box", ...
```
Run: `yarn test:ct pdf-selection` → FAIL → wire in → PASS.

- [ ] **Step 4: Commit** — `git commit -m "Add PDF text selection with store-level pending selection"`

---

### Task 10: DOCX annotator

**Files:**
- Create: `src/docx/{index.ts,DocxAnnotator.tsx,DocxView.tsx,projection.ts,docxOffsetUtils.ts}`, `ct-tests/helpers/docxodusWasm.ts` (port of `oc-src/frontend/tests/utils/docxodusWasm.ts`), `ct-tests/wrappers/DocxHarness.tsx`, `ct-tests/docx.ct.tsx`
- Test: `src/docx/__tests__/{getGlobalOffset,projection}.test.ts`

**Interfaces:**
- Consumes: everything Tasks 3–5 produce.
- Produces: `DocxAnnotator` (forwardRef to `AnnotatorHandle`, props `DocxAnnotatorProps`); `buildProjectionSet(input: { text: string; annotations: SpanAnnotation[]; highlights: Highlight[]; activeHighlightId: string | null }): ExternalAnnotationSet`; DOM contract `[data-annotation-id="<id>"]` (emitted by docxodus), root `[data-rca-docx]`. `DocxHarness` mirrors `PdfHarness` (`window.__rca`, `window.__rcaEvents`).

- [ ] **Step 1: Port `docxOffsetUtils.ts` and its test** (`OC:…/renderers/docx/__tests__/getGlobalOffset.test.ts`). Run → PASS.

- [ ] **Step 2: Failing projection tests**

```ts
test("span annotations become labelledText entries with start/end/text", ...
test("span highlights become synthetic entries; the active one uses the selected synthetic label", ...
test("token annotations and token/bounds highlights are dropped", ...
test("an annotation whose offsets fall outside the text is dropped", ...      // d-bad-span, Review Focus 4
test("start >= end is dropped", ...
```
Implement `projection.ts` from `buildExternalAnnotationSet` in `OC:…/docx/DocxAnnotator.tsx`: search results and chat sources collapse into highlights (synthetic label ids `__highlight__` and `__highlight_active__`). Run → PASS.

- [ ] **Step 3: Port the view**

`DocxView.tsx` ← `DocxAnnotator.tsx` keeping the four-stage pipeline (init WASM → convert + DOMPurify → project → CSS), `PaginatedDocument`, and DOM-offset disambiguation. Changes:
  - `initDocxodus(wasmBaseUrl)`; no `import.meta.env`.
  - Input annotations are `useVisibleAnnotations()` filtered to `kind === "span"` (shared filter replaces the local structural filter; the CSS label-visibility stage stays for `labelDisplay: "hide"` only).
  - Selection: on `mouseup` with a non-collapsed native selection inside the root, compute `{start,end,text}` as today and call `useCompleteSelection()({ json: {start,end}, rawText: text, page: 0, annotationLabel: null }, anchor)` where anchor is the selection rect's bottom-centre. Remove the built-in menu, `getSpan`, and the CRUD callback props. While a selection is pending, project it as a synthetic entry `__pending__` so it stays painted after the native selection is cleared.
  - Clicks: plain click replaces selection, Ctrl/Cmd toggles, click on un-annotated text clears — all `{source:"user"}`; `onAnnotationClick` / `onAnnotationHover` fire with `annotation.source`.
  - Scroll requests: for annotation and highlight targets, find `[data-annotation-id]` under the root, centre it by setting the root's scroll offsets, `complete(seq, true)`; retry on animation frames until projection has produced the element.
  - Driver: `kind: "span"`, `getPageCount: () => null`, `getVisiblePageRange: () => null`, `scrollToPage: () => false`, `resolveFitWidth: () => 1`, `getText: () => text`, `findText` = substring search over `text` returning `{ id: "find-<n>", target: { kind: "span", start, end } }`, `canDraw` true for known span ids / span highlights.
  - Zoom: `scale={zoom}` as today.
  - `devWarnOnce` when `renderAnnotationActions`, `selectedRelationIds`, or an annotation with `approved`/`rejected`/`linkUrl` is supplied.
  - `source: {url}` is fetched with `fetch`, aborted on change/unmount; status/progress go to `documentStatusAtom`.

- [ ] **Step 4: Failing component tests** (`setupDocxodusWasm(page)` + `serveFixtures(page)` before mount; harness passes `wasmBaseUrl="/docxodus-wasm/"`)

```ts
test("renders the document; onDocumentLoad fires with pageCount null and the text", ...
test("annotations d-1 and d-2 are projected as [data-annotation-id]", ...
test("d-bad-span is skipped and the others still render", ...                 // Review Focus 4
test("scrollToAnnotation('d-2') resolves true and the element is in view", ...
test("span highlight is painted; activeHighlightId scrolls to it", ...
test("click selects (uncontrolled); ctrl-click toggles; click on plain text clears", ...
test("controlled selection: click fires onSelectionChange and DOM selection state follows the prop only", ...
test("selecting text -> onTextSelect with start/end matching text.slice(start,end) === rawText", ...
test("outcome 2 with activeLabel -> onCreateAnnotation with json {start,end}", ...
test("outcome 1 with renderSelectionMenu -> slot shown, pending stays painted, commit creates", ...
test("showStructural toggles structural spans; visibleLabelIds filters; selected stays visible when filtered", ...
test("labelDisplay 'hide' removes label chips; any other value shows them", ...
test("setZoom(1.5) scales the document; setZoom('fit-width') -> getZoom() === 1", ...
test("findText returns span highlights whose slices equal the query", ...
test("getPageCount() null, scrollToPage(1) false", ...
test("no chrome in the root", ...
```
Run: `yarn test:ct docx` → FAIL → implement `DocxAnnotator.tsx` + harness → PASS.

- [ ] **Step 5: Commit** — `git commit -m "Add DOCX annotator on the shared shell"`

---

### Task 11: Dispatcher, export adapter, entry-point isolation

**Files:**
- Create: `src/DocumentAnnotator.tsx`, `src/index.ts`, `src/core/fromOpenContractsExport.ts`, `scripts/check-dist.mjs`, `ct-tests/wrappers/DispatcherHarness.tsx`, `ct-tests/dispatcher.ct.tsx`
- Test: `src/core/__tests__/fromOpenContractsExport.test.ts`

**Interfaces:**
- Produces: `DocumentAnnotator` (forwardRef to `AnnotatorHandle`; props `AnnotatorCommonProps & { document: DocumentInput }`), implemented with `React.lazy(() => import("./pdf/index"))` / `import("./docx/index")` under one `Suspense` whose fallback is `renderLoading?.(null) ?? null`.
- Produces: `fromOpenContractsExport(doc: OpenContractDocExport, labels?: Record<string, { id?: string; text: string; color?: string; description?: string; icon?: string }>): { annotations: Annotation[]; relations: Relation[]; pawls: PawlsPage[]; text: string }`, and the `OpenContractDocExport` type (fields: `title`, `content`, `description`, `pawls_file_content`, `page_count`, `doc_labels`, `labelled_text[]` with `id`, `annotationLabel` (name), `rawText`, `page`, `annotation_json`, `structural`, optional `link_url`; optional `relationships[]` with `id`, `relationshipLabel`, `source_annotation_ids`, `target_annotation_ids`, optional `structural`).

- [ ] **Step 1: Failing adapter tests**

```ts
test("labelled_text maps to Annotation with label objects from the lookup", ...
test("without a lookup, a label is synthesised: id === text === name and a stable colour for the same name", ...
test("annotation ids are stringified; missing ids get 'ann-<index>'", ...
test("token and span annotation_json pass through unchanged", ...
test("relationships map to Relation with stringified ids", ...
test("pawls_file_content -> pawls, content -> text", ...
test("link_url maps to linkUrl", ...
```
Check the exact optional field names against `oc-src/opencontractserver/types/dicts.py` (`OpenContractsAnnotationPythonType`, `OpenContractsRelationshipPythonType`) before writing the type. Implement → PASS.

- [ ] **Step 2: Failing dispatcher component tests**

```ts
test("document.format 'pdf' renders the PDF viewer and the ref handle works (getPageCount 23)", ...
test("document.format 'docx' renders the DOCX viewer (getPageCount null)", ...
test("switching format remounts cleanly and clears selection", ...
```
Implement `DocumentAnnotator.tsx` and `src/index.ts` (dispatcher + `export * from "./core/index"`). `src/pdf/index.ts` and `src/docx/index.ts` each also `export * from "../core/index"`. Run → PASS.

- [ ] **Step 3: Write `scripts/check-dist.mjs` and run it**

After `yarn build` it walks the static import graph of each entry in `dist/` and fails when: `dist/pdf/index.js` reaches a chunk importing `docxodus` or `dompurify`; `dist/docx/index.js` reaches one importing `pdfjs-dist`; `dist/core/index.js` reaches either; `dist/index.js` reaches either through a *static* import (dynamic is expected); any chunk contains `@apollo/client`, `react-router`, `lodash`; or any `.d.ts` for the four entries is missing.

Run: `yarn build && node scripts/check-dist.mjs` → Expected: `dist OK: 4 entries`.

- [ ] **Step 4: Add `check-dist` to CI after build. Commit** — `git commit -m "Add dispatcher, export adapter and entry-point isolation check"`

---

### Task 12: Parity check, demo, README

**Files:**
- Create: `scripts/parity/capture.test.tsx`, `fixtures/parity/eton.json`, `src/pdf/__tests__/parity.test.tsx`, `examples/demo/**`, `README.md`
- Modify: `.github/workflows/ci.yml` (build the demo)

**Interfaces:**
- Produces: `fixtures/parity/eton.json` = `{ commit: "98286cabf", cases: [{ id, pageIndex, zoom, boundary: { left, top, width, height }, tokens: [{ left, top, width, height }] }] }` for annotations `a-title`, `a-compact`, `a-multi` (both pages), `a-far`, at zoom 1 and 1.5.

- [ ] **Step 1: Capture from OpenContracts' own code**

```bash
cd /home/jman/Code/oc-src/frontend && yarn install --frozen-lockfile
mkdir -p src/__parity__ && cp /home/jman/Code/react-contract-annotate/scripts/parity/capture.test.tsx src/__parity__/
RCA_FIXTURES=/home/jman/Code/react-contract-annotate/fixtures yarn vitest run src/__parity__/capture.test.tsx
```
`capture.test.tsx` builds OC's `PDFPageInfo` for each page from `pawls.json` with a stub `PDFPageProxy` whose `getViewport({scale})` returns `{ width: page.width * scale, height: page.height * scale }`, constructs OC `ServerTokenAnnotation`s from `annotations.json`, renders OC's `SelectionBoundary` and `SelectionTokenGroup` under jsdom with OC's providers mocked as its own unit tests do, reads the inline `left/top/width/height` styles, and writes `eton.json`. Remove `src/__parity__` afterwards; the worktree is never committed.
Expected: `fixtures/parity/eton.json` with 10 cases.

- [ ] **Step 2: Failing parity test in the library**

```ts
test.each(cases)("$id page $pageIndex @ $zoom matches OpenContracts", ...
  // same stub page proxy; render the library's SelectionBoundary + TokenGroup under AnnotatorProvider;
  // inline styles deep-equal the captured values (toBeCloseTo, 3 decimals)
```
Run: `yarn test src/pdf/__tests__/parity.test.tsx` → Expected: PASS. A failure here is a porting bug in Task 7; fix it there, do not adjust the fixture.

- [ ] **Step 3: Demo app** `examples/demo` (Vite + React, depends on the library via `"@os-legal/react-contract-annotate": "portal:../.."`): one page, a format switch (PDF / DOCX) and a "controlled / internal state" switch above the viewer; plain HTML buttons outside the viewer for zoom in / out / fit, a `<select>` of annotation ids that calls `scrollToAnnotation(id, {select:true})`, a `<select>` of labels feeding `activeLabel`, a text box calling `findText` and feeding `highlights`, a next-hit button; created drafts are appended to host state; a `<pre>` shows the last 10 callback events. Vite config serves `fixtures/` and the docxodus wasm directory at `/docxodus-wasm/`.

Run: `yarn build && yarn --cwd examples/demo install && yarn --cwd examples/demo build` → exit 0. Then `yarn --cwd examples/demo dev`, open it, and confirm by hand: PDF and DOCX both render, jump works, drag-select with a label creates an annotation, the controlled switch behaves. Record what was checked in the PR description.

- [ ] **Step 4: README** — install (with the optional-peer table from the spec), pdf.js worker setup via `configurePdfWorker`, docxodus wasm hosting, a minimal PDF example and a minimal DOCX example (both taken from the demo), the controlled-vs-internal pattern, the three selection outcomes, the click model, the DOCX support matrix, `fromOpenContractsExport`, "adding a format" (the `FormatDriver` contract), and acknowledgements (OpenContracts; AllenAI PAWLS).

- [ ] **Step 5: Full verification**

Run: `yarn lint:imports && yarn typecheck && yarn test && yarn test:ct && yarn build && node scripts/check-dist.mjs`
Expected: all exit 0.

- [ ] **Step 6: Commit, push, open the PR**

```bash
git add -A && git commit -m "Add parity check, demo app and README"
git push origin initial-extraction
gh pr create --base main --head initial-extraction --title "Initial extraction: PDF and DOCX annotators" --body-file <(…summary, test evidence, manual demo checks…)
git -C /home/jman/Code/OpenContracts worktree remove --force /home/jman/Code/oc-src
```
Expected: PR URL printed; CI green on the PR.
