/**
 * The highlighted tokens of an annotation on one page: one rounded,
 * low-opacity rect per token, `[data-rca-token="<owner id>"]`. Ported from
 * OpenContracts' `SelectionTokenGroup`
 * (`annotator/display/components/SelectionTokenGroup.tsx`, 98286cabf) with
 * the same geometry: `left` / `top` / `width` / `height` are computed exactly
 * as there.
 *
 * Changed from OpenContracts: a token index the page does not have is
 * skipped (OpenContracts drew a zero-size rect at its fallback bounds); the
 * `uniqueId()` element ids and the `scrollTo` effect are gone.
 *
 * The group must be a sibling of the box, not inside it: the rects are
 * positioned against the page's canvas wrapper.
 */
import styled from "styled-components";

import type { TokenId } from "../core/index";
import {
  ANNOTATION_TOKEN_RADIUS,
  TOKEN_EXPANSION_PX,
  TOKEN_OPACITY_HIGH,
  TOKEN_OPACITY_LOW,
  TOKEN_SHADOW_BLUR,
  TOKEN_SHADOW_SPREAD,
} from "./constants";
import type { PDFPageInfo } from "./PDFPageInfo";

interface SelectionBoxProps {
  $highOpacity?: boolean;
  $color?: string;
  $left?: number;
  $right?: number;
  $top?: number;
  $bottom?: number;
  $hidden?: boolean;
}

// Highlighter-pen effect: generous rounding, low opacity, and a soft
// same-colour blur that feathers the edges into the page.
const SelectionBox = styled.span.attrs<SelectionBoxProps>((props) => ({
  style: {
    left: `${(props.$left ?? 0) - TOKEN_EXPANSION_PX}px`,
    top: `${(props.$top ?? 0) - TOKEN_EXPANSION_PX}px`,
    width: `${
      props.$right && props.$left
        ? props.$right - props.$left + TOKEN_EXPANSION_PX * 2
        : 0
    }px`,
    height: `${
      props.$bottom && props.$top
        ? props.$bottom - props.$top + TOKEN_EXPANSION_PX * 2
        : 0
    }px`,
    backgroundColor: props.$color || "yellow",
    opacity: props.$highOpacity ? TOKEN_OPACITY_HIGH : TOKEN_OPACITY_LOW,
    display: props.$hidden ? "none" : "block",
    boxShadow: props.$hidden
      ? "none"
      : `0 0 ${TOKEN_SHADOW_BLUR}px ${TOKEN_SHADOW_SPREAD}px ${
          props.$color || "rgba(255,255,0,0.15)"
        }`,
  },
}))<SelectionBoxProps>`
  position: absolute;
  pointer-events: none;
  border-radius: ${ANNOTATION_TOKEN_RADIUS};
  transition: opacity 0.3s ease-in-out;
`;

export interface TokenGroupProps {
  /** Id of the annotation the tokens belong to: the `data-rca-token` value. */
  ownerId: string;
  color?: string;
  hidden?: boolean;
  /** The page at the current zoom. */
  pageInfo: PDFPageInfo;
  highOpacity?: boolean;
  tokens: TokenId[] | null;
}

export function TokenGroup({
  ownerId,
  color,
  hidden,
  pageInfo,
  highOpacity,
  tokens,
}: TokenGroupProps) {
  // Bad data (an index past the end of the page's tokens) is skipped.
  const drawable = (tokens ?? []).filter(
    (t) => t != null && pageInfo.tokens[t.tokenIndex] !== undefined
  );
  return (
    <div>
      {drawable.map((t, i) => {
        const b = pageInfo.getScaledTokenBounds(pageInfo.tokens[t.tokenIndex]);
        return (
          <SelectionBox
            key={i}
            data-rca-token={ownerId}
            $hidden={hidden}
            $highOpacity={highOpacity}
            $color={color ? color : undefined}
            $left={b.left}
            $right={b.right}
            $top={b.top}
            $bottom={b.bottom}
          />
        );
      })}
    </div>
  );
}
