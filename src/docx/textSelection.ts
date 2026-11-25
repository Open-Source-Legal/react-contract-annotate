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
 * the laid-out pages only (counting the pagination's staging copy shifted it
 * by the whole document, so repeated text always resolved to its last
 * occurrence); repeated text is told apart by the selection's start rather
 * than its anchor (the end, for a backward drag); a whitespace-insensitive
 * match is mapped back to `text` exactly, whitespace run by whitespace run,
 * and its occurrences are told apart like exact ones (OpenContracts searched
 * `text` again for the selection's first and last 30 characters verbatim:
 * a short selection was not found at all, and the end could land on an
 * earlier occurrence of the last 30 characters); and a span that does not
 * name text in `text` is never returned.
 */
import { findTextOccurrences } from "docxodus";

import type { SpanAnnotationJson } from "../core/index";
import { ANNOTATION_LABEL_CLASS } from "./constants";
import {
  getGlobalOffsetFromDomPosition,
  isDrawableSpan,
  pickClosestOccurrence,
} from "./docxOffsetUtils";

/** Every occurrence, however many (the docxodus default is 100). */
const ALL_OCCURRENCES = Number.MAX_SAFE_INTEGER;

/** A run of whitespace, or a run of anything else. */
const WHITESPACE_OR_NOT = /\s+|\S+/g;

/**
 * `text` with every run of whitespace collapsed to one space (as
 * `text.replace(/\s+/g, " ")` does), and for each of its UTF-16 units the
 * offset in `text` it comes from (a run's first, for a collapsed run).
 */
function collapseWhitespace(text: string): {
  collapsed: string;
  offsets: number[];
} {
  let collapsed = "";
  const offsets: number[] = [];
  for (const { 0: part, index } of text.matchAll(WHITESPACE_OR_NOT)) {
    if (/^\s/.test(part)) {
      collapsed += " ";
      offsets.push(index);
      continue;
    }
    collapsed += part;
    for (let unit = 0; unit < part.length; unit++) offsets.push(index + unit);
  }
  return { collapsed, offsets };
}

/**
 * The occurrences of `query` in `text` when every run of whitespace in both
 * counts as one space, as offsets into `text`. `query` must have no
 * whitespace at either end, so every occurrence starts and ends on a
 * character of `text`.
 */
function whitespaceInsensitiveOccurrences(
  text: string,
  query: string
): SpanAnnotationJson[] {
  const { collapsed, offsets } = collapseWhitespace(text);
  return findTextOccurrences(
    collapsed,
    query.replace(/\s+/g, " "),
    ALL_OCCURRENCES
  ).map(({ start, end }) => ({
    start: offsets[start],
    end: offsets[end - 1] + 1,
  }));
}

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
  // (the pagination's page numbers).
  const rawText = selection.toString();
  const cleanedText = rawText
    .replace(/\n\d+\n/g, "\n") // Remove "1", "2" etc. between newlines
    .trim();

  if (!cleanedText) return null;

  // Search for the cleaned text in docText
  let occurrences = findTextOccurrences(text, cleanedText, ALL_OCCURRENCES);

  // If no exact match (common for cross-page selections with whitespace
  // differences), match with every run of whitespace as one space
  if (occurrences.length === 0) {
    occurrences = whitespaceInsensitiveOccurrences(text, cleanedText);
  }

  if (occurrences.length === 0) return null;

  // Disambiguate if multiple matches using DOM position
  let span = occurrences[0];
  if (occurrences.length > 1) {
    const range = selection.getRangeAt(0);
    const startOffset = getGlobalOffsetFromDomPosition(
      pages,
      range.startContainer,
      range.startOffset,
      ANNOTATION_LABEL_CLASS,
      pageNumberClass
    );
    if (startOffset !== null) {
      span = pickClosestOccurrence(occurrences, startOffset);
    }
  }
  return isDrawableSpan(span, text) ? span : null;
}
