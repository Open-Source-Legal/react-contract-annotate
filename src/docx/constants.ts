/**
 * Constants of the DOCX format: ported value-for-value from OpenContracts'
 * `DocxAnnotator` / `docxOffsetUtils` (`renderers/docx/`, 98286cabf) and the
 * `OS_LEGAL_COLORS` they read, then the library's own additions.
 */

// ---------------------------------------------------------------------------
// Ported from OpenContracts
// ---------------------------------------------------------------------------

/** CSS class prefix of the elements docxodus' projection produces. */
export const CSS_CLASS_PREFIX = "oc-annot-";

/** Class of annotation label elements injected by the WASM renderer. */
export const ANNOTATION_LABEL_CLASS = "oc-annot-label";

/**
 * Class of the page numbers docxodus' pagination draws (not document text)
 * with its default prefix; each annotator's own is `pageClass(scope,
 * "number")`.
 */
export const PAGE_NUMBER_CLASS = "page-number";

/** Gap (px) the pagination leaves between pages. */
export const PAGE_GAP_PX = 20;

/** Background of the paginated view (`OS_LEGAL_COLORS.background`). */
export const DOCUMENT_BACKGROUND = "#fafafa";

/** Outline of a selected annotation (`OS_LEGAL_COLORS.primaryBlue`). */
export const SELECTED_OUTLINE_COLOR = "#3b82f6";
/** Fill of a selected annotation (`primaryBlue` at 0.15). */
export const SELECTED_BACKGROUND = "rgba(59, 130, 246, 0.15)";
/** Outline of a hovered annotation (`OS_LEGAL_COLORS.borderHover`). */
export const HOVER_OUTLINE_COLOR = "#cbd5e1";
/** Opacity (%) of an annotation's label colour behind its text (0.15). */
export const LABEL_BACKGROUND_PERCENT = 15;
/**
 * The base rule of a projected span, as docxodus' `generateAnnotationCss`
 * (12.4.1) writes it: its colour mixed in at this share (%), and the colour
 * used when the span has none.
 */
export const SPAN_BACKGROUND_PERCENT = 30;
export const ANNOTATION_FALLBACK_COLOR = "#FFEB3B";

/**
 * The label chip (a `::before` on an annotation's first span): the fallbacks
 * of `--rca-label-font-size` and `--rca-z-label-chip`.
 */
export const LABEL_CHIP_FONT_SIZE = "0.65em";
export const LABEL_CHIP_Z_INDEX = 10;

/**
 * How long (ms) the chip with the host's controls stays once the pointer has
 * left its annotation: long enough to move the pointer onto the chip.
 */
export const ACTION_CHIP_LINGER_MS = 300;
/** The type of that chip: the PDF format's label chip's. */
export const ACTION_CHIP_FONT_SIZE = "12px";
export const ACTION_CHIP_FONT_WEIGHT = "bold";

// ---------------------------------------------------------------------------
// Library additions
// ---------------------------------------------------------------------------

/**
 * Synthetic label ids of what is projected besides annotations (replacing
 * OpenContracts' search-result and chat-source labels): highlights, the
 * active highlight, and the pending selection. They are reserved: an
 * annotation label with one of these ids is drawn as that synthetic kind.
 */
export const HIGHLIGHT_LABEL_ID = "__highlight__";
export const ACTIVE_HIGHLIGHT_LABEL_ID = "__highlight_active__";
export const PENDING_LABEL_ID = "__pending__";
/** Id of the projected entry of the pending selection. */
export const PENDING_ENTRY_ID = "__pending__";

/**
 * Colour of the pending selection: the PDF format's (`SELECTION_COLOR`,
 * OpenContracts' `SelectionLayer` literal).
 */
export const PENDING_COLOR = "#0066cc";

/** How a click on a link to a bookmark in the document scrolls to it. */
export const BOOKMARK_SCROLL_BEHAVIOR: ScrollBehavior = "smooth";
