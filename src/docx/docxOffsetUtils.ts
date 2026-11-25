/**
 * Character offsets into the DOCX text. Ported from OpenContracts'
 * `docxOffsetUtils.ts` (`renderers/docx/`, 98286cabf): an approximate offset
 * of a DOM selection point, used to tell repeated occurrences of the
 * selected text apart, and the pick of the closest occurrence. Added: the
 * literal search `findText` answers with.
 *
 * Changed from OpenContracts: the tree walker comes from the container's own
 * document.
 */
import type { Highlight } from "../core/index";
import { ANNOTATION_LABEL_CLASS, PAGE_NUMBER_CLASS } from "./constants";

export { ANNOTATION_LABEL_CLASS };

/**
 * Compute an approximate character offset from a DOM selection point.
 *
 * Walks text nodes in document order within the container, skipping text
 * inside annotation label elements (injected by the WASM renderer and not
 * part of the original document text). The result may differ slightly from
 * the true docText offset (e.g. inter-paragraph newlines in docText aren't
 * present as DOM text nodes), but is close enough to disambiguate which
 * occurrence of repeated text the user selected via closest-match.
 */
export function getGlobalOffsetFromDomPosition(
  container: HTMLElement,
  node: Node | null,
  localOffset: number,
  cssClassPrefix: string = ANNOTATION_LABEL_CLASS
): number | null {
  if (!node) return null;

  // If the node is an element, resolve to the child at the given offset
  let targetNode: Node = node;
  let targetOffset: number = localOffset;
  if (node.nodeType === Node.ELEMENT_NODE) {
    const el = node as HTMLElement;
    if (localOffset < el.childNodes.length) {
      targetNode = el.childNodes[localOffset];
      targetOffset = 0;
    } else if (el.childNodes.length > 0) {
      // Past the end — point to end of last child
      targetNode = el.childNodes[el.childNodes.length - 1];
      targetOffset = targetNode.textContent?.length ?? 0;
    } else {
      return null;
    }
  }

  // Classes whose text content is NOT part of docText and should be skipped.
  // Includes annotation labels (WASM renderer) and page numbers (PaginatedDocument).
  const SKIP_CLASSES = [cssClassPrefix, PAGE_NUMBER_CLASS];
  // Tag names whose text content is NOT part of docText (e.g. <style>, <title>).
  const SKIP_TAGS = new Set(["STYLE", "TITLE", "SCRIPT"]);

  const walker = container.ownerDocument.createTreeWalker(
    container,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode: (n: Node) => {
        let parent = n.parentElement;
        while (parent && parent !== container) {
          if (SKIP_TAGS.has(parent.tagName)) {
            return NodeFilter.FILTER_SKIP;
          }
          if (SKIP_CLASSES.some((cls) => parent!.classList.contains(cls))) {
            return NodeFilter.FILTER_SKIP;
          }
          parent = parent.parentElement;
        }
        return NodeFilter.FILTER_ACCEPT;
      },
    }
  );

  let globalOffset = 0;
  let current: Node | null;
  while ((current = walker.nextNode())) {
    if (current === targetNode) {
      return globalOffset + targetOffset;
    }
    globalOffset += current.textContent?.length ?? 0;
  }

  return null;
}

/**
 * Pick the closest occurrence of text based on an approximate DOM offset.
 *
 * Given multiple occurrences (from findTextOccurrences) and an approximate
 * character offset from the DOM, returns the occurrence whose start position
 * is closest to the DOM offset.
 */
export function pickClosestOccurrence(
  occurrences: Array<{ start: number; end: number }>,
  approximateOffset: number
): { start: number; end: number } {
  return occurrences.reduce((closest, occ) =>
    Math.abs(occ.start - approximateOffset) <
    Math.abs(closest.start - approximateOffset)
      ? occ
      : closest
  );
}

function escapeRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Every non-overlapping occurrence of `query` in `text`, in order, as span
 * highlights `find-0`, `find-1`, …. The query is matched literally;
 * case-insensitive unless `caseSensitive`. An empty query matches nothing.
 */
export function findSpanMatches(
  text: string,
  query: string,
  { caseSensitive = false }: { caseSensitive?: boolean } = {}
): Highlight[] {
  if (query === "") return [];
  // Without the `u` flag a case-insensitive comparison works per UTF-16 unit
  // and never changes a match's length, so the offsets index into `text`
  // (lowercasing the text could change its length, e.g. "İ").
  const pattern = new RegExp(escapeRegExp(query), caseSensitive ? "g" : "gi");
  const highlights: Highlight[] = [];
  for (const match of text.matchAll(pattern)) {
    const start = match.index ?? 0;
    highlights.push({
      id: `find-${highlights.length}`,
      target: { kind: "span", start, end: start + match[0].length },
    });
  }
  return highlights;
}
