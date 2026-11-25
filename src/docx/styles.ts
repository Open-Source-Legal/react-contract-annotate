/**
 * The stylesheet the DOCX format generates for what it projects: label
 * colours and label chips, the selected annotations, the highlights' own
 * colours and the active highlight. Ported from the `customCss` of
 * OpenContracts' `DocxAnnotator` (`renderers/docx/DocxAnnotator.tsx`,
 * 98286cabf), with the base `.oc-annot-highlight` rule underneath that
 * OpenContracts had docxodus' `generateAnnotationCss` generate.
 *
 * Label chips are `::before` pseudo-elements on an annotation's first span
 * (`content: attr(data-label)`), so they are not elements: `labelDisplay:
 * "hide"` leaves their rules out, any other value shows them.
 *
 * Changed from OpenContracts: every rule is scoped to the instance's
 * `[data-rca-docx]` element, so two annotators on a page never style each
 * other; ids and label ids are written as escaped CSS strings and colours
 * go through `labelColor` / `highlightColor`, so host data cannot break out
 * of a rule; the label background is a `color-mix` (any CSS colour, not only
 * hex); a highlight's colour is its own (`--annot-color`) instead of one per
 * source; the chip's font size and stacking are the custom properties
 * `--rca-label-font-size` and `--rca-z-label-chip`; a page zoomed wider
 * than the view is aligned to the start, so all of it can be scrolled to;
 * and the base highlight rule is written here, scoped, instead of by
 * `generateAnnotationCss`, whose per-label rules (`.oc-annot-label-<id>`,
 * unused: a projected element carries its colour inline) put label ids into
 * a page-wide stylesheet unescaped.
 */
import { highlightColor, labelColor } from "../core/index";
import type { AnnotationLabel, Highlight, LabelDisplay } from "../core/index";
import {
  ACTIVE_HIGHLIGHT_LABEL_ID,
  ANNOTATION_FALLBACK_COLOR,
  CSS_CLASS_PREFIX,
  HIGHLIGHT_LABEL_ID,
  HOVER_OUTLINE_COLOR,
  LABEL_BACKGROUND_PERCENT,
  LABEL_CHIP_FONT_SIZE,
  LABEL_CHIP_Z_INDEX,
  PENDING_LABEL_ID,
  SELECTED_BACKGROUND,
  SELECTED_OUTLINE_COLOR,
  SPAN_BACKGROUND_PERCENT,
} from "./constants";
import { cssString } from "./cssString";
import { pageClass } from "./isolation";
import type { DocxScope } from "./isolation";

const SYNTHETIC_LABEL_IDS = [
  HIGHLIGHT_LABEL_ID,
  ACTIVE_HIGHLIGHT_LABEL_ID,
  PENDING_LABEL_ID,
] as const;

const labelIs = (id: string) => `[data-label-id=${cssString(id)}]`;
const annotationIdIs = (id: string) => `[data-annotation-id=${cssString(id)}]`;

/** Matches the elements of annotations, not those of the synthetic entries. */
const NOT_SYNTHETIC = SYNTHETIC_LABEL_IDS.map(
  (id) => `:not(${labelIs(id)})`
).join("");

const HIGHLIGHT = `.${CSS_CLASS_PREFIX}highlight`;
const SINGLE = `.${CSS_CLASS_PREFIX}single`;
const START = `.${CSS_CLASS_PREFIX}start`;

export interface DocxCssInput {
  /** The instance's scope. */
  scope: DocxScope;
  /** Every annotation label of the document, once each. */
  labels: readonly AnnotationLabel[];
  selectedIds: readonly string[];
  /** The span highlights (others are ignored). */
  highlights: readonly Highlight[];
  labelDisplay: LabelDisplay;
}

export function buildDocxCss({
  scope,
  labels,
  selectedIds,
  highlights,
  labelDisplay,
}: DocxCssInput): string {
  const root = scope.selector;
  const rules: string[] = [];
  const rule = (selectors: string[], body: string) =>
    rules.push(
      `${selectors.map((s) => `${root} ${s}`).join(",\n")} {\n${body}\n}`
    );

  // docxodus centres the pages (`align-items: center`), so a page wider than
  // the view (zoomed in) overflows on both sides and its left part can never
  // be scrolled to. `safe` aligns it to the start once it overflows.
  rule([`.${pageClass(scope, "container")}`], "  align-items: safe center;");
  // What every projected span looks like, in its label's colour (set inline
  // by docxodus as `--annot-color`).
  rule(
    [HIGHLIGHT],
    "  background-color: color-mix(in srgb, " +
      `var(--annot-color, ${ANNOTATION_FALLBACK_COLOR}) ` +
      `${SPAN_BACKGROUND_PERCENT}%, transparent);\n` +
      `  border-bottom: 2px solid var(--annot-color, ${ANNOTATION_FALLBACK_COLOR});\n` +
      "  display: inline;\n" +
      "  padding: 0.1em 0;"
  );
  // Annotation spans need relative positioning for the ::before labels.
  rule([SINGLE, START], "  position: relative;");
  rule(
    ["[data-annotation-id]"],
    "  cursor: pointer;\n  transition: outline 0.15s ease, background-color 0.15s ease;"
  );
  rule(
    ["[data-annotation-id]:hover"],
    `  outline: 1px solid ${HOVER_OUTLINE_COLOR};\n  outline-offset: 1px;`
  );
  // Highlights and the pending selection are painted, not clicked.
  rule(SYNTHETIC_LABEL_IDS.map(labelIs), "  cursor: default;");

  for (const label of labels) {
    const color = labelColor(label);
    const labelled = labelIs(label.id);
    rule(
      [`${HIGHLIGHT}${labelled}`],
      `  background-color: color-mix(in srgb, ${color} ${LABEL_BACKGROUND_PERCENT}%, transparent);\n` +
        `  border-bottom: 2px solid ${color};`
    );
    if (labelDisplay === "hide") continue;
    rule(
      [`${SINGLE}${labelled}::before`, `${START}${labelled}::before`],
      [
        "  content: attr(data-label);",
        "  position: absolute;",
        "  top: -1.4em;",
        "  left: 0;",
        `  font-size: var(--rca-label-font-size, ${LABEL_CHIP_FONT_SIZE});`,
        "  line-height: 1;",
        "  padding: 1px 4px;",
        "  border-radius: 3px;",
        `  background-color: ${color};`,
        "  color: white;",
        "  white-space: nowrap;",
        "  pointer-events: auto;",
        "  cursor: pointer;",
        `  z-index: var(--rca-z-label-chip, ${LABEL_CHIP_Z_INDEX});`,
      ].join("\n")
    );
  }

  // Each highlight in its own colour, over the one its synthetic label has.
  for (const highlight of highlights) {
    if (highlight.target.kind !== "span") continue;
    const id = annotationIdIs(highlight.id);
    rule(
      [
        id + labelIs(HIGHLIGHT_LABEL_ID),
        id + labelIs(ACTIVE_HIGHLIGHT_LABEL_ID),
      ],
      `  --annot-color: ${highlightColor(highlight)} !important;`
    );
  }
  rule(
    [labelIs(ACTIVE_HIGHLIGHT_LABEL_ID)],
    "  outline: 2px solid var(--annot-color);\n  outline-offset: 1px;"
  );

  for (const id of selectedIds) {
    rule(
      [annotationIdIs(id) + NOT_SYNTHETIC],
      `  outline: 2px solid ${SELECTED_OUTLINE_COLOR} !important;\n` +
        "  outline-offset: 1px;\n" +
        `  background-color: ${SELECTED_BACKGROUND} !important;`
    );
  }

  return rules.join("\n");
}
