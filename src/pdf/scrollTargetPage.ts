/**
 * The page a scroll request's target is scrolled to: where its box is drawn
 * first. The driver (can it be drawn at all), the viewport (which page to
 * jump to) and the page (does the request's last step happen here) all ask
 * this, so they cannot disagree about a target that needs another.
 */
import { annotationPages } from "../core/index";
import type {
  Highlight,
  InternalAnnotation,
  ScrollTarget,
} from "../core/index";
import { firstDrawnPage } from "./highlightBounds";
import type { PDFPageInfo } from "./PDFPageInfo";

/**
 * Index of the page the target is drawn on first; null when this format
 * cannot draw it now. An annotation is drawable once it is a token annotation
 * whose first page is one of the document's pages (the display filters are
 * not consulted, so `scrollToAnnotation(id, { select: true })` can reveal a
 * hidden annotation). A highlight is drawable once it has a `tokens` or
 * `bounds` box on one of the pages (a `span` highlight never is).
 */
export function scrollTargetPage(
  target: ScrollTarget,
  annotations: readonly InternalAnnotation[],
  highlights: readonly Highlight[],
  pages: readonly PDFPageInfo[]
): number | null {
  if (target.kind === "highlight") {
    const highlight = highlights.find((h) => h.id === target.id);
    return highlight ? firstDrawnPage(highlight, pages) : null;
  }
  const annotation = annotations.find((a) => a.id === target.id);
  if (annotation?.kind !== "token") return null;
  const firstPage = annotationPages(annotation)[0];
  return firstPage !== undefined && firstPage < pages.length ? firstPage : null;
}
