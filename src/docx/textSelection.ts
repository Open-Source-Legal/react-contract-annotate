/**
 * The text the user selected in the laid-out pages, as offsets into the
 * document text. Ported from the `handleMouseUp` of OpenContracts'
 * `DocxAnnotator` (`renderers/docx/DocxAnnotator.tsx`, 98286cabf): the
 * selected text is searched for in `text` (`findTextOccurrences`, then
 * whitespace-insensitively) and, when it occurs more than once, the
 * occurrence nearest the selection's DOM offset is taken.
 *
 * Changed from OpenContracts: every occurrence is considered (docxodus'
 * `findTextOccurrences` stops at 100 by default, so the 101st occurrence of a
 * phrase or later resolved to an earlier one); the DOM offset is measured in
 * the laid-out pages only (counting `PaginatedDocument`'s staging copy
 * shifted it by the whole document, so repeated text always resolved to its
 * last occurrence); repeated text is told apart by the selection's start
 * rather than its anchor (the end, for a backward drag); and a
 * whitespace-insensitive match that cannot be mapped back to `text` selects
 * nothing instead of offsets into the normalised text.
 */
import { findTextOccurrences } from "docxodus";

import type { SpanAnnotationJson } from "../core/index";
import { ANNOTATION_LABEL_CLASS } from "./constants";
import {
  getGlobalOffsetFromDomPosition,
  pickClosestOccurrence,
} from "./docxOffsetUtils";

/** Every occurrence, however many (the docxodus default is 100). */
const ALL_OCCURRENCES = Number.MAX_SAFE_INTEGER;

/** The native selection, when it selects text and starts in `pages`. */
export function selectionIn(pages: HTMLElement | null): Selection | null {
  const selection = pages?.ownerDocument.getSelection() ?? null;
  return pages &&
    selection &&
    !selection.isCollapsed &&
    selection.rangeCount > 0 &&
    selection.toString().trim() !== "" &&
    pages.contains(selection.anchorNode)
    ? selection
    : null;
}

/**
 * The offsets in `text` of the text selected in `pages`; null when the text
 * is not found. `pageNumberClass` is the class of the page numbers, which
 * are not document text.
 */
export function selectedSpan(
  text: string,
  selection: Selection,
  pages: HTMLElement,
  pageNumberClass: string
): SpanAnnotationJson | null {
  // Get the raw selected text. For cross-page selections this may
  // include page number artifacts (e.g. "...text\n1\nmore text...").
  // Clean it by removing isolated numbers on their own lines
  // (PaginatedDocument page numbers).
  const rawText = selection.toString();
  const cleanedText = rawText
    .replace(/\n\d+\n/g, "\n") // Remove "1", "2" etc. between newlines
    .trim();

  if (!cleanedText) return null;

  // Search for the cleaned text in docText
  let occurrences = findTextOccurrences(text, cleanedText, ALL_OCCURRENCES);

  // If no exact match (common for cross-page selections with whitespace
  // differences), try collapsing whitespace for a fuzzy match
  if (occurrences.length === 0) {
    const normalized = cleanedText.replace(/\s+/g, " ");
    occurrences = findTextOccurrences(
      text.replace(/\s+/g, " "),
      normalized,
      ALL_OCCURRENCES
    );
    // Map back to original docText offsets by searching from the
    // normalized match position
    if (occurrences.length > 0) {
      const approxStart = occurrences[0].start;
      // Find the actual position in docText near this offset
      const searchWindow = text.substring(
        Math.max(0, approxStart - 50),
        approxStart + cleanedText.length + 50
      );
      const firstWords = cleanedText.substring(0, 30);
      const idx = searchWindow.indexOf(firstWords);
      occurrences = [];
      if (idx >= 0) {
        const realStart = Math.max(0, approxStart - 50) + idx;
        // Find the end by matching the last few words
        const lastWords = cleanedText.substring(cleanedText.length - 30);
        const endSearch = text.indexOf(
          lastWords,
          realStart + cleanedText.length - 60
        );
        if (endSearch >= 0) {
          occurrences = [
            { start: realStart, end: endSearch + lastWords.length },
          ];
        }
      }
    }
  }

  if (occurrences.length === 0) return null;

  // Disambiguate if multiple matches using DOM position
  if (occurrences.length === 1) return occurrences[0];
  const range = selection.getRangeAt(0);
  const startOffset = getGlobalOffsetFromDomPosition(
    pages,
    range.startContainer,
    range.startOffset,
    ANNOTATION_LABEL_CLASS,
    pageNumberClass
  );
  return startOffset === null
    ? occurrences[0]
    : pickClosestOccurrence(occurrences, startOffset);
}
