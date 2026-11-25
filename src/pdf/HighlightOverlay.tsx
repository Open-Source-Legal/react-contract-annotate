/**
 * The highlights of one PDF page: for each highlight that has something on
 * the page, its box (the given `boundsByPage`, else the box around its
 * tokens), the rects of its tokens and the label chip. One overlay for what
 * OpenContracts draws with three: search results, chat sources and the
 * deep-linked text block. Ported from OpenContracts' `ResultBoundary`,
 * `SearchResult`, `SelectionTokens`, `ChatSourceResult` and
 * `TextBlockHighlight` (`annotator/display/components/`, 98286cabf); the box
 * is the annotation's `SelectionBoundary` (same geometry, fill and halo) and
 * the token rects its `TokenGroup`.
 *
 * Every supplied highlight is painted; the active one gets the selected fill
 * and halo and `data-active`. A click that is not a drag makes a highlight
 * the active one (as a user change: it does not scroll); a plain press goes on
 * to the layers below. A `span` highlight cannot be drawn on a PDF: it is
 * ignored, with one development warning per annotator.
 *
 * DOM contract: `[data-rca-highlight="<id>"][data-rca-page-part="<page>"]`,
 * with `data-active` present on the active highlight only; its token rects
 * are `[data-rca-highlight-token="<id>"]`.
 *
 * Changed from OpenContracts: no `id`s (`SEARCH_RESULT_…`,
 * `CHAT_SOURCE_…`), ref registry, `scrollIntoView` or lazily cached
 * `match.bounds` (scrolling is driven by scroll requests; bounds are derived
 * on render); the colour is the highlight's (default: the text-block blue)
 * instead of one per source; the label is the highlight's own `label`
 * instead of "Search Result n of N"; and the stacking is `--rca-z-highlight`.
 * Colours are hex, as label colours are.
 */
import { useEffect, useMemo, useState } from "react";
import styled from "styled-components";

import {
  highlightColor,
  isSpanHighlight,
  LabelChip,
  useActiveHighlightId,
  useDevWarnOnce,
  useDisplaySettings,
  useHighlights,
  useSetControllable,
} from "../core/index";
import type {
  BoundingBox,
  ChangeInfo,
  Highlight,
  LabelDisplay,
} from "../core/index";
import {
  ANNOTATION_LABEL_FONT_SIZE,
  ANNOTATION_LABEL_FONT_WEIGHT,
  HIGHLIGHT_Z_INDEX,
} from "./constants";
import { highlightPageBounds, highlightTokenIds } from "./highlightBounds";
import type { PDFPageInfo } from "./PDFPageInfo";
import { SelectionBoundary } from "./SelectionBoundary";
import { TokenGroup } from "./TokenGroup";

const USER: ChangeInfo = Object.freeze({ source: "user" });

const SPAN_WARNING_KEY = "pdf-span-highlight";
const SPAN_WARNING =
  'The PDF annotator cannot draw highlights whose target.kind is "span" ' +
  '(they index into the text of a DOCX); they are ignored. Use "tokens" ' +
  'or "bounds" targets for a PDF.';

const HIGHLIGHT_Z_INDEX_VALUE = `var(--rca-z-highlight, ${HIGHLIGHT_Z_INDEX})`;

// The bar above the box that holds the chip: out of the way of the pointer,
// right-aligned to the box, in the annotations' label type.
const LabelBar = styled.div`
  position: absolute;
  right: 0;
  bottom: calc(100% - 2px);
  display: flex;
  justify-content: flex-end;
  pointer-events: none;
  user-select: none;
  font-weight: var(--rca-label-font-weight, ${ANNOTATION_LABEL_FONT_WEIGHT});
  font-size: var(--rca-label-font-size, ${ANNOTATION_LABEL_FONT_SIZE});
`;

/** A highlight with its box (unscaled) on the page being drawn. */
type DrawnHighlight = { highlight: Highlight; bounds: BoundingBox };

interface HighlightBoxProps extends DrawnHighlight {
  /** The page at the current zoom. */
  pageInfo: PDFPageInfo;
  active: boolean;
  showBoundingBox: boolean;
  labelDisplay: LabelDisplay;
  onActivate: (id: string) => void;
}

function HighlightBox({
  highlight,
  bounds,
  pageInfo,
  active,
  showBoundingBox,
  labelDisplay,
  onActivate,
}: HighlightBoxProps) {
  const [hovered, setHovered] = useState(false);
  const pageIndex = pageInfo.page.pageNumber - 1;
  const color = highlightColor(highlight);
  const tokens = highlightTokenIds(highlight, pageIndex);
  const chipVisible =
    highlight.label !== undefined &&
    (labelDisplay === "always" ||
      (labelDisplay === "hover" && (hovered || active)));

  return (
    <>
      <SelectionBoundary
        showBoundingBox={showBoundingBox}
        color={color}
        bounds={pageInfo.getScaledBounds(bounds)}
        selected={active}
        onHover={setHovered}
        onClickWithoutDrag={() => onActivate(highlight.id)}
        zIndex={HIGHLIGHT_Z_INDEX_VALUE}
        dataAttributes={{
          "data-rca-highlight": highlight.id,
          "data-rca-page-part": String(pageIndex),
          ...(active ? { "data-active": "" } : {}),
        }}
      >
        {chipVisible && (
          <LabelBar>
            <LabelChip
              annotation={{
                annotationLabel: {
                  id: highlight.id,
                  text: highlight.label ?? "",
                },
              }}
              color={color}
              visible
            />
          </LabelBar>
        )}
      </SelectionBoundary>
      {
        // Beside the box, not in it: the rects are positioned against the
        // page's canvas wrapper (see `AnnotationBox`).
        tokens.length > 0 && (
          <TokenGroup
            ownerId={highlight.id}
            attribute="data-rca-highlight-token"
            color={color}
            highOpacity={!showBoundingBox}
            pageInfo={pageInfo}
            tokens={tokens}
          />
        )
      }
    </>
  );
}

export interface HighlightOverlayProps {
  /** The page at the current zoom. */
  pageInfo: PDFPageInfo;
}

export function HighlightOverlay({ pageInfo }: HighlightOverlayProps) {
  const highlights = useHighlights();
  const activeId = useActiveHighlightId();
  const { showBoundingBoxes, labelDisplay } = useDisplaySettings();
  const setActive = useSetControllable<string | null>("activeHighlight");
  const warnOnce = useDevWarnOnce();

  const hasSpanHighlight = highlights.some(isSpanHighlight);
  useEffect(() => {
    if (hasSpanHighlight) warnOnce(SPAN_WARNING_KEY, SPAN_WARNING);
  }, [hasSpanHighlight, warnOnce]);

  const drawn = useMemo(
    () =>
      highlights.flatMap((highlight): DrawnHighlight[] => {
        const bounds = highlightPageBounds(highlight, pageInfo);
        return bounds ? [{ highlight, bounds }] : [];
      }),
    [highlights, pageInfo]
  );

  return (
    <>
      {drawn.map(({ highlight, bounds }) => (
        <HighlightBox
          key={highlight.id}
          highlight={highlight}
          bounds={bounds}
          pageInfo={pageInfo}
          active={highlight.id === activeId}
          showBoundingBox={showBoundingBoxes}
          labelDisplay={labelDisplay}
          onActivate={(id) => setActive(id, USER)}
        />
      ))}
    </>
  );
}
