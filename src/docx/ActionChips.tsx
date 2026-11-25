/**
 * Label chips with the host's controls, for a DOCX. The format's own label
 * chips are CSS `::before` pseudo-elements (see `styles.ts`), which can hold
 * no button. So the annotations a reader is working with, the one under the
 * pointer and the selected ones, get a real chip (core's `LabelChip`, as on
 * a PDF) laid over their CSS one, with the host's `annotationActions`
 * buttons and `renderAnnotationActions` content in it.
 *
 * The chips are in the frame, outside the scope element: the document's own
 * stylesheet does not reach them, and a press or a click on one is not one
 * in the document. They are placed in the frame's coordinates, above the
 * start of the annotation's first line, so they scroll with the pages.
 */
import { useEffect, useLayoutEffect, useState } from "react";
import type { CSSProperties, RefObject } from "react";

import {
  LabelChip,
  labelColor,
  useAnnotationActionButtons,
  useRenderAnnotationActions,
} from "../core/index";
import type { InternalAnnotation } from "../core/index";
import {
  ACTION_CHIP_FONT_SIZE,
  ACTION_CHIP_FONT_WEIGHT,
  LABEL_CHIP_Z_INDEX,
} from "./constants";

/** Where a chip is, in the frame's coordinates: the top left of the annotation. */
type Position = { left: number; top: number };

export interface ActionChipsProps {
  /** The frame the chips are placed in. */
  frame: RefObject<HTMLElement>;
  /** The annotations to give a chip, in the order the chips are written. */
  annotations: readonly InternalAnnotation[];
  /** The annotation under the pointer, or null. */
  pointerId: string | null;
  selectedIds: readonly string[];
  /** The first laid-out element of an annotation; null when it is not drawn. */
  elementOf(id: string): HTMLElement | null;
  /** Changes whenever the pages are laid out again. */
  layout: unknown;
  /** The pointer came onto a chip, or left one. */
  onPointerEnter(): void;
  onPointerLeave(): void;
}

function positionOf(element: HTMLElement, frame: HTMLElement): Position {
  // The first line of an annotation that wraps: where its CSS chip is.
  const start = element.getClientRects()[0] ?? element.getBoundingClientRect();
  const origin = frame.getBoundingClientRect();
  return { left: start.left - origin.left, top: start.top - origin.top };
}

function chipStyle({ left, top }: Position): CSSProperties {
  return {
    position: "absolute",
    left,
    top,
    // Its bottom edge on the top of the line, as the CSS chip's.
    transform: "translateY(-100%)",
    zIndex: `var(--rca-z-label-chip, ${LABEL_CHIP_Z_INDEX})`,
    fontSize: ACTION_CHIP_FONT_SIZE,
    fontWeight: ACTION_CHIP_FONT_WEIGHT,
    whiteSpace: "nowrap",
  };
}

interface ActionChipProps
  extends Pick<
    ActionChipsProps,
    "frame" | "elementOf" | "layout" | "onPointerEnter" | "onPointerLeave"
  > {
  annotation: InternalAnnotation;
  hovered: boolean;
  selected: boolean;
  /** Changes whenever the frame changes size. */
  frameSize: number;
}

function ActionChip({
  annotation,
  hovered,
  selected,
  frame,
  elementOf,
  layout,
  frameSize,
  onPointerEnter,
  onPointerLeave,
}: ActionChipProps) {
  const buttons = useAnnotationActionButtons(annotation.source);
  const renderActions = useRenderAnnotationActions();
  const [position, setPosition] = useState<Position | null>(null);

  useLayoutEffect(() => {
    const element = elementOf(annotation.id);
    const next =
      element && frame.current ? positionOf(element, frame.current) : null;
    setPosition((previous) =>
      previous?.left === next?.left && previous?.top === next?.top
        ? previous
        : next
    );
    // `elementOf` reads the pages as they are; `layout` and `frameSize` say
    // when they changed.
  }, [annotation.id, frame, elementOf, layout, frameSize]);

  const content = renderActions?.(annotation.source, { selected, hovered });
  const hasContent = content != null && content !== false;
  if (position === null || (buttons === null && !hasContent)) return null;
  return (
    <div
      data-rca-docx-actions={annotation.id}
      style={chipStyle(position)}
      onMouseEnter={onPointerEnter}
      onMouseLeave={onPointerLeave}
    >
      <LabelChip
        annotation={annotation}
        color={labelColor(annotation.annotationLabel)}
        visible
        actions={buttons}
      >
        {content}
      </LabelChip>
    </div>
  );
}

/** A number that changes whenever `frame` changes size. */
function useFrameSize(frame: RefObject<HTMLElement>): number {
  const [size, setSize] = useState(0);
  useEffect(() => {
    const element = frame.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => setSize((seen) => seen + 1));
    observer.observe(element);
    return () => observer.disconnect();
  }, [frame]);
  return size;
}

export function ActionChips({
  annotations,
  pointerId,
  selectedIds,
  ...shared
}: ActionChipsProps) {
  const frameSize = useFrameSize(shared.frame);
  return (
    <>
      {annotations.map((annotation) => (
        <ActionChip
          key={annotation.id}
          annotation={annotation}
          hovered={annotation.id === pointerId}
          selected={selectedIds.includes(annotation.id)}
          frameSize={frameSize}
          {...shared}
        />
      ))}
    </>
  );
}
