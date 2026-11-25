/**
 * The label chip of a rendered annotation: the label text on the label's
 * colour, with the host's `renderAnnotationActions` content beside it.
 * Ported from OpenContracts' `LabelTagContainer`
 * (`annotator/display/components/Containers.tsx`, 98286cabf) and the chip
 * body of `Selection.tsx`, without the radial action cloud, the pencil and
 * trash icons and the external-link icon. The label text comes from the
 * ported `annotationChipLabel` (`annotator/utils/urlAnnotation.ts`).
 */
import type { ReactNode, SyntheticEvent } from "react";
import styled from "styled-components";

import {
  DEFAULT_LABEL_COLOR,
  REFERENCE_MENTION_DISPLAY_NAMES,
  THEME_DEFAULTS,
} from "./constants";
import { safeCssColor } from "./geometry/colorUtils";
import { getContrastColor } from "./geometry/transform";
import type { AnnotationLabel } from "./types";

/**
 * Human-facing chip label for an annotation. Enrichment reference mentions
 * carry machine-readable label codes (`OC_REF_LAW` …); surfacing those raw on
 * the hover chip reads as noise. Map them to plain names ("Law", "Exhibit",
 * …); everything else shows its own label text unchanged.
 */
function annotationChipLabel(annotation: {
  annotationLabel?: AnnotationLabel | null;
}): string {
  const text = annotation.annotationLabel?.text ?? "";
  return Object.hasOwn(REFERENCE_MENTION_DISPLAY_NAMES, text)
    ? REFERENCE_MENTION_DISPLAY_NAMES[text]
    : text;
}

/**
 * The colour a label is drawn in: its own when it is a safe CSS colour, else
 * OpenContracts' default label grey.
 */
export function labelColor(label: AnnotationLabel | null | undefined): string {
  return safeCssColor(label?.color, DEFAULT_LABEL_COLOR);
}

const LabelTagContainer = styled.div<{ $color: string }>`
  display: flex;
  align-items: center;
  background-color: ${(props) => props.$color};
  color: ${(props) => getContrastColor(props.$color)};
  padding: 2px 8px;
  border-radius: 5px;
  position: relative;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.08);
  font-family: var(--rca-font-family, ${THEME_DEFAULTS.fontFamily});
`;

/**
 * The host's content is not part of the document: pressing or clicking it
 * neither starts a text selection nor counts as a click on the annotation.
 */
function stopPropagation(event: SyntheticEvent): void {
  event.stopPropagation();
}

export interface LabelChipProps {
  annotation: { annotationLabel: AnnotationLabel };
  /** Background colour; an unsafe CSS value falls back to the default grey. */
  color: string;
  /** When false nothing is rendered. */
  visible: boolean;
  /** The host's content (`renderAnnotationActions`), after the label text. */
  children?: ReactNode;
}

/** `[data-rca-label-chip]`: the label text, then the host's content. */
export function LabelChip({
  annotation,
  color,
  visible,
  children,
}: LabelChipProps) {
  if (!visible) return null;
  return (
    <LabelTagContainer
      data-rca-label-chip=""
      $color={safeCssColor(color, DEFAULT_LABEL_COLOR)}
    >
      <div
        style={{
          position: "relative",
          display: "flex",
          alignItems: "center",
        }}
      >
        <div
          style={{
            whiteSpace: "nowrap",
            overflowX: "visible",
            display: "flex",
            alignItems: "center",
            gap: "4px",
          }}
        >
          <span>{annotationChipLabel(annotation)}</span>
        </div>
        {children != null && children !== false && (
          <span
            data-rca-annotation-actions=""
            onMouseDown={stopPropagation}
            onTouchStart={stopPropagation}
            onClick={stopPropagation}
          >
            {children}
          </span>
        )}
      </div>
    </LabelTagContainer>
  );
}
