/**
 * The box of an annotation on one page: a translucent fill in the label's
 * colour, a halo while bounding boxes are shown, and the approved / rejected
 * glow. Ported from OpenContracts' `SelectionBoundary`
 * (`annotator/display/components/SelectionBoundary.tsx`, 98286cabf) with the
 * same geometry: `left` / `top` / `width` / `height` are computed exactly as
 * there.
 *
 * Changed from OpenContracts: Ctrl / Cmd act like Shift; the box reports
 * every click that was not a drag (`onClickWithoutDrag`); the annotation-ref
 * registry, `scrollIntoView` and the `isCreatingAnnotation` gate are gone
 * (scrolling is driven by scroll requests and looks the box up under the
 * instance root); the static `id` is replaced by the caller's `data-*`
 * attributes; and the hard-coded `zIndex: 2` is `--rca-z-annotation`.
 */
import { useRef } from "react";
import type { MouseEvent as ReactMouseEvent, ReactNode } from "react";
import styled, { css } from "styled-components";

import { computeAnnotationBoxShadow, hexToRgb } from "../core/index";
import type { BoundingBox } from "../core/index";
import {
  ANNOTATION_BOUNDARY_RADIUS,
  ANNOTATION_Z_INDEX,
  APPROVED_RGB,
  BOUNDARY_OPACITY_SELECTED,
  BOUNDARY_OPACITY_UNSELECTED,
  CLICK_DRAG_TOLERANCE_PX,
  REJECTED_RGB,
} from "./constants";
import { pulseGreen, pulseMaroon } from "./effects";

interface SelectionBoundaryProps {
  /** Default false. */
  hidden?: boolean;
  showBoundingBox?: boolean;
  color: string;
  bounds: BoundingBox;
  selected: boolean;
  children?: ReactNode;
  onHover?: (hovered: boolean) => void;
  /**
   * Called for a Shift / Ctrl / Cmd click, and for a plain click when
   * `clickThroughOnPlainClick` is set; the event goes no further.
   */
  onClick?: (event: ReactMouseEvent) => void;
  /**
   * When true, plain (non-modifier) clicks also invoke ``onClick``. Used for
   * hyperlink-style annotations (`linkUrl`) where a single click should open
   * the link. When false (default) the modifier-click-to-select semantic is
   * preserved, so plain presses fall through to the layers below and don't
   * interfere with selecting text underneath.
   */
  clickThroughOnPlainClick?: boolean;
  /**
   * Called for every click, with or without modifiers, whose press and
   * release are within `CLICK_DRAG_TOLERANCE_PX`; after `onClick`.
   */
  onClickWithoutDrag?: (event: ReactMouseEvent) => void;
  approved?: boolean;
  rejected?: boolean;
  /** `data-*` attributes set on the box element (the DOM contract). */
  dataAttributes?: Record<`data-${string}`, string>;
}

const BoundarySpan = styled.span.attrs<{
  $width: number;
  $height: number;
  $rotateX: number;
  $rotateY: number;
  $bounds: BoundingBox;
  $backgroundColor: string;
  $boxShadow: string;
  $approved?: boolean;
  $rejected?: boolean;
}>((props) => ({
  style: {
    position: "absolute",
    left: `${props.$bounds.left}px`,
    top: `${props.$bounds.top}px`,
    width: `${Math.abs(props.$width)}px`,
    height: `${Math.abs(props.$height)}px`,
    transform: `rotateY(${props.$rotateY}deg) rotateX(${props.$rotateX}deg)`,
    backgroundColor: props.$backgroundColor,
    zIndex: `var(--rca-z-annotation, ${ANNOTATION_Z_INDEX})`,
    border: "none",
    boxShadow: props.$boxShadow,
    transformOrigin: "top left",
    transition:
      "background-color 0.4s ease, box-shadow 0.4s ease, opacity 0.4s ease",
  },
}))`
  border-radius: ${ANNOTATION_BOUNDARY_RADIUS};

  ${(props) =>
    props.$approved &&
    css`
      box-shadow:
        0 0 12px 3px
          rgba(${APPROVED_RGB.r}, ${APPROVED_RGB.g}, ${APPROVED_RGB.b}, 0.18),
        0 0 4px 1px
          rgba(${APPROVED_RGB.r}, ${APPROVED_RGB.g}, ${APPROVED_RGB.b}, 0.12) !important;
      animation: ${pulseGreen} 2s infinite;
    `}

  ${(props) =>
    props.$rejected &&
    css`
      box-shadow:
        0 0 12px 3px
          rgba(${REJECTED_RGB.r}, ${REJECTED_RGB.g}, ${REJECTED_RGB.b}, 0.18),
        0 0 4px 1px
          rgba(${REJECTED_RGB.r}, ${REJECTED_RGB.g}, ${REJECTED_RGB.b}, 0.12) !important;
      animation: ${pulseMaroon} 2s infinite;
    `}
`;

/** Shift, Ctrl or Cmd: the modifiers that select instead of passing through. */
function isModifierClick(event: ReactMouseEvent): boolean {
  return event.shiftKey || event.ctrlKey || event.metaKey;
}

export function SelectionBoundary({
  hidden = false,
  showBoundingBox = false,
  color,
  bounds,
  children,
  onHover,
  onClick,
  clickThroughOnPlainClick = false,
  onClickWithoutDrag,
  selected,
  approved,
  rejected,
  dataAttributes,
}: SelectionBoundaryProps) {
  /** Where the last press on the box happened, until its click. */
  const pressRef = useRef<{ x: number; y: number } | null>(null);

  const width = bounds.right - bounds.left;
  const height = bounds.bottom - bounds.top;
  const rotateY = width < 0 ? -180 : 0;
  const rotateX = height < 0 ? -180 : 0;
  const { r, g, b } = hexToRgb(color);
  // Fill ignores showBoundingBox so multi-line inter-row gaps don't stripe through as white.
  const opacity = hidden
    ? 0
    : selected
      ? BOUNDARY_OPACITY_SELECTED
      : BOUNDARY_OPACITY_UNSELECTED;
  const backgroundColor = `rgba(${r}, ${g}, ${b}, ${opacity})`;

  const boxShadow =
    showBoundingBox && !hidden
      ? computeAnnotationBoxShadow(r, g, b, selected)
      : "none";

  const handleClick = (e: ReactMouseEvent) => {
    const press = pressRef.current;
    pressRef.current = null;
    // A click without a recorded press (keyboard, script) moved nowhere.
    const withoutDrag =
      press === null ||
      Math.hypot(e.clientX - press.x, e.clientY - press.y) <=
        CLICK_DRAG_TOLERANCE_PX;
    if (onClick && (isModifierClick(e) || clickThroughOnPlainClick)) {
      e.stopPropagation();
      onClick(e);
    }
    if (withoutDrag) onClickWithoutDrag?.(e);
  };

  const handleMouseDown = (e: ReactMouseEvent) => {
    pressRef.current = { x: e.clientX, y: e.clientY };
    if (!onClick) return;
    if (isModifierClick(e) || clickThroughOnPlainClick) {
      e.stopPropagation();
    }
  };

  return (
    <BoundarySpan
      {...dataAttributes}
      onClick={handleClick}
      onMouseDown={handleMouseDown}
      onMouseEnter={onHover && !hidden ? () => onHover(true) : undefined}
      onMouseLeave={onHover && !hidden ? () => onHover(false) : undefined}
      $width={width}
      $height={height}
      $rotateX={rotateX}
      $rotateY={rotateY}
      $boxShadow={boxShadow}
      $backgroundColor={backgroundColor}
      $bounds={bounds}
      $approved={approved}
      $rejected={rejected}
      style={{
        pointerEvents: "auto",
        cursor: clickThroughOnPlainClick ? "pointer" : undefined,
      }}
    >
      {children || null}
    </BoundarySpan>
  );
}
