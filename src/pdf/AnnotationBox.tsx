/**
 * One token annotation drawn on one page: its box, its token highlights, the
 * label chip (per `labelDisplay`, with the host's `renderAnnotationActions`
 * inside) and the SOURCE / TARGET badge of a selected relation. Ported from
 * OpenContracts' `Selection` (`annotator/display/components/Selection.tsx`,
 * 98286cabf) and the `SelectionInfo` / `SelectionInfoContainer` containers
 * of `Containers.tsx`.
 *
 * Removed from OpenContracts: the auth token, the radial action cloud, the
 * pencil and trash icons, both modals, every mutation hook and `useNavigate`.
 * The `selection_<id>` class and static ids are replaced by the DOM contract:
 * `[data-rca-annotation][data-rca-page-part]` with `data-selected`,
 * `data-approved` and `data-rejected`.
 *
 * Click model (spec "Clicks keep each format's current model"): Shift / Ctrl /
 * Cmd-click toggles the annotation in the selection as a user change; a plain
 * click on a link annotation opens it; any other plain press passes through
 * to the layers below. Every click that was not a drag goes to
 * `onAnnotationClick`, after the library's own action.
 *
 * Changed from OpenContracts: the chip of `labelDisplay: "hover"` also shows
 * while the annotation is selected; the relation badge shows on the
 * endpoints of the first selected relation whether or not they are selected
 * (relation selection no longer selects its endpoints); and the box is never
 * hidden in place, because visibility is decided by `useVisibleAnnotations`
 * alone.
 *
 * Theming (custom properties, defaulting to OpenContracts' values):
 * `--rca-label-font-weight` / `--rca-label-font-size` for the label bar,
 * `--rca-z-relation-badge` / `--rca-relation-badge-font-size` for the badge.
 */
import { useEffect, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import styled, { css } from "styled-components";

import {
  isUrlAnnotation,
  LabelChip,
  labelColor,
  useDisplaySettings,
  useOnAnnotationClick,
  useOnAnnotationHover,
  useOpenLink,
  useRenderAnnotationActions,
  useSelectedAnnotationIds,
  useSelectedRelations,
  useSetControllable,
} from "../core/index";
import type { ChangeInfo, Relation, TokenAnnotation } from "../core/index";
import {
  ANNOTATION_BOUNDARY_RADIUS,
  ANNOTATION_LABEL_FONT_SIZE,
  ANNOTATION_LABEL_FONT_WEIGHT,
  RELATION_BADGE_FONT_SIZE,
  RELATION_BADGE_Z_INDEX,
} from "./constants";
import type { PDFPageInfo } from "./PDFPageInfo";
import { SelectionBoundary } from "./SelectionBoundary";
import { TokenGroup } from "./TokenGroup";

const USER: ChangeInfo = Object.freeze({ source: "user" });

type RelationRole = "SOURCE" | "TARGET";

/**
 * Whether the annotation is a source or a target of `relation`. Ported from
 * OpenContracts' `annotationSelectedViaRelationship` (`annotator/utils.ts`).
 */
function annotationSelectedViaRelationship(
  annotationId: string,
  relation: Relation
): RelationRole | "" {
  if (relation.sourceIds.includes(annotationId)) return "SOURCE";
  if (relation.targetIds.includes(annotationId)) return "TARGET";
  return "";
}

const RelationshipIndicator = styled.div<{ $type: RelationRole }>`
  position: absolute;
  left: -24px;
  top: 50%;
  transform: translateY(-50%);
  display: flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: ${(props) =>
    props.$type === "SOURCE"
      ? "rgba(25, 118, 210, 0.95)" // Blue for source
      : "rgba(230, 74, 25, 0.95)" // Orange-red for target
  };
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
  cursor: help;
  z-index: var(--rca-z-relation-badge, ${RELATION_BADGE_Z_INDEX}); // Ensure it's above other elements

  /* Create tooltip */
  &::before {
    content: "${(props) => props.$type}";
    position: absolute;
    left: -8px;
    transform: translateX(-100%);
    background: rgba(0, 0, 0, 0.8);
    color: white;
    padding: 2px 6px;
    border-radius: 3px;
    font-size: var(--rca-relation-badge-font-size, ${RELATION_BADGE_FONT_SIZE});
    white-space: nowrap;
    opacity: 0;
    pointer-events: none; // Prevent tooltip from interfering with hover
    transition: opacity 0.2s ease;
  }

  &::after {
    content: "";
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: white;
    animation: ${(props) =>
      props.$type === "SOURCE"
        ? "sourcePulse 2s infinite"
        : "targetPulse 2s infinite"};
    pointer-events: none;
  }

  /* Show tooltip on hover */
  &:hover::before {
    opacity: 1;
  }
`;

// The bar above the box that holds the chip and the relation badge. Its
// width (the box's) is an inline style: a per-box value in the template would
// generate a class per box.
const SelectionInfo = styled.div<{
  $color: string;
  $showBoundingBox: boolean;
  $approved?: boolean;
  $rejected?: boolean;
}>`
  position: absolute;
  right: 0px;
  bottom: calc(100% - 2px);
  border-radius: ${ANNOTATION_BOUNDARY_RADIUS} ${ANNOTATION_BOUNDARY_RADIUS} 0 0;
  background: ${(props) =>
    props.$showBoundingBox ? props.$color : "transparent"};
  padding: 1px 8px;
  font-weight: var(--rca-label-font-weight, ${ANNOTATION_LABEL_FONT_WEIGHT});
  font-size: var(--rca-label-font-size, ${ANNOTATION_LABEL_FONT_SIZE});
  user-select: none;
  box-sizing: border-box;
  transition: all 0.4s ease-in-out;

  ${(props) =>
    props.$approved &&
    css`
      box-shadow: 0 -2px 10px 2px rgba(46, 204, 113, 0.12);
    `}

  ${(props) =>
    props.$rejected &&
    css`
      box-shadow: 0 -2px 10px 2px rgba(231, 76, 60, 0.12);
    `}

  * {
    vertical-align: middle;
  }
`;

const SelectionInfoContainer = styled.div`
  position: relative;
  display: flex;
  flex-direction: row;
  justify-content: space-between;
  align-items: center;
  pointer-events: none; // Let hover events pass through to children

  /* Enable pointer events only on interactive elements */
  > * {
    pointer-events: auto;
  }
`;

const VerticallyJustifiedEndDiv = styled.div`
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  margin: 0px;
`;

export interface AnnotationBoxProps {
  annotation: TokenAnnotation;
  /** The page at the current zoom. */
  pageInfo: PDFPageInfo;
}

export function AnnotationBox({ annotation, pageInfo }: AnnotationBoxProps) {
  const [hovered, setHovered] = useState(false);
  const selectedIds = useSelectedAnnotationIds();
  const setSelection = useSetControllable<string[]>("selection");
  const { showBoundingBoxes, labelDisplay } = useDisplaySettings();
  const selectedRelation: Relation | undefined = useSelectedRelations()[0];
  const renderAnnotationActions = useRenderAnnotationActions();
  const reportClick = useOnAnnotationClick();
  const reportHover = useOnAnnotationHover();
  const openLink = useOpenLink();

  // A box removed under the pointer (filtered out, its page scrolled out of
  // the window) gets no mouseleave: report the end of the hover itself.
  const hoveredRef = useRef(false);
  useEffect(
    () => () => {
      if (hoveredRef.current) reportHover(null);
    },
    [reportHover]
  );

  const pageIndex = pageInfo.page.pageNumber - 1;
  const pageJson = annotation.json[pageIndex];
  // A page without bounds (bad data) draws nothing.
  if (!pageJson?.bounds) return null;

  const selected = selectedIds.includes(annotation.id);
  const color = labelColor(annotation.annotationLabel);
  const bounds = pageInfo.getScaledBounds(pageJson.bounds);
  const isLinkAnnotation = isUrlAnnotation(annotation);
  const chipVisible =
    labelDisplay === "always" ||
    (labelDisplay === "hover" && (hovered || selected));
  const relationshipType = selectedRelation
    ? annotationSelectedViaRelationship(annotation.id, selectedRelation)
    : "";

  // Called for modifier clicks, and for plain clicks on a link annotation.
  const onModifierOrLinkClick = (event: ReactMouseEvent) => {
    const modifier = event.shiftKey || event.metaKey || event.ctrlKey;
    if (isLinkAnnotation && !modifier && annotation.linkUrl) {
      openLink(annotation.linkUrl.trim(), annotation.source);
      return;
    }
    const next = selected
      ? selectedIds.filter((other) => other !== annotation.id)
      : [...selectedIds, annotation.id];
    setSelection(next, USER);
  };

  const onHover = (isHovered: boolean) => {
    hoveredRef.current = isHovered;
    setHovered(isHovered);
    reportHover(isHovered ? annotation.source : null);
  };

  return (
    <>
      <SelectionBoundary
        showBoundingBox={showBoundingBoxes}
        color={color}
        bounds={bounds}
        onHover={onHover}
        onClick={onModifierOrLinkClick}
        clickThroughOnPlainClick={isLinkAnnotation}
        onClickWithoutDrag={(event) => reportClick(annotation.source, event)}
        approved={annotation.approved}
        rejected={annotation.rejected}
        selected={selected}
        dataAttributes={{
          "data-rca-annotation": annotation.id,
          "data-rca-page-part": String(pageIndex),
          "data-selected": String(selected),
          "data-approved": String(annotation.approved),
          "data-rejected": String(annotation.rejected),
        }}
      >
        <SelectionInfo
          style={{ width: `${bounds.right - bounds.left}px` }}
          $color={color}
          $showBoundingBox={showBoundingBoxes}
          $approved={annotation.approved}
          $rejected={annotation.rejected}
        >
          <SelectionInfoContainer>
            {relationshipType && (
              <RelationshipIndicator
                data-rca-relation-role={relationshipType}
                $type={relationshipType}
              />
            )}
            <VerticallyJustifiedEndDiv>
              <LabelChip
                annotation={annotation}
                color={color}
                visible={chipVisible}
              >
                {chipVisible && renderAnnotationActions
                  ? renderAnnotationActions(annotation.source, {
                      selected,
                      hovered,
                    })
                  : null}
              </LabelChip>
            </VerticallyJustifiedEndDiv>
          </SelectionInfoContainer>
        </SelectionInfo>
      </SelectionBoundary>
      {
        // NOTE: It's important that the parent element of the tokens
        // is the PDF canvas, because we need their absolute position
        // to be relative to that and not another absolute/relatively
        // positioned element. This is why the tokens are not inside
        // SelectionBoundary.
        pageJson.tokensJsons && (
          <TokenGroup
            ownerId={annotation.id}
            color={annotation.annotationLabel.color}
            highOpacity={!showBoundingBoxes}
            pageInfo={pageInfo}
            tokens={pageJson.tokensJsons}
          />
        )
      }
    </>
  );
}
