/**
 * Keeps a converted document to its own annotator (spec "Isolation"): its
 * stylesheet must not restyle the host page or another annotator, it must
 * fetch nothing, the host's class names must not collide with the
 * document's, and its element ids must not repeat across annotators.
 *
 * - Every annotator gets a random scope (`createDocxScope`), unique across
 *   React roots: the value of its `[data-rca-docx]` attribute, and the root
 *   of the class prefixes docxodus is asked to use for the document's classes
 *   and the pagination elements, so they are the annotator's own.
 * - The document's `<style>` blocks are taken out of its HTML and returned
 *   as one stylesheet, scoped and reduced to allow-listed declarations
 *   (`scopeStylesheet.ts`, which validates the stylesheet it returns: that
 *   validation and the allow-list of `cssAllowList.ts` are the security
 *   boundary). A stylesheet that fails the validation is dropped whole and
 *   reported (`cssRejected`).
 * - Inline `style` attributes are reduced to allow-listed declarations the
 *   same way (`cleanInlineStyle`).
 * - Element ids are prefixed with the scope, and same-document links
 *   (`href="#…"`) follow them. The ids `PaginatedDocument` gives its
 *   staging and page containers are removed (it finds them by class).
 *
 * What a scoped stylesheet can still do to the scope element itself is
 * contained by the frame the DOCX view puts around it (`DocxView`).
 */
import { cssString } from "./cssString";
import { cleanInlineStyle, scopeStylesheets } from "./scopeStylesheet";
import type { CssParser } from "./scopeStylesheet";

export interface DocxScope {
  /** Value of the annotator's `data-rca-docx` attribute; random per mount. */
  id: string;
  /** Selector of the annotator's `[data-rca-docx]` element. */
  selector: string;
  /** Prefix of the document's element ids. */
  idPrefix: string;
  /** Class prefix of the document's own classes (docxodus' `cssPrefix`). */
  documentPrefix: string;
  /**
   * Class prefix of the pagination elements: docxodus'
   * `paginationCssClassPrefix` and `PaginatedDocument`'s `cssPrefix`.
   */
  pagePrefix: string;
}

/** A random id: a UUID where the context offers one (secure contexts). */
function randomId(): string {
  const { crypto } = globalThis;
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}

/** A new scope; create one per mounted annotator. */
export function createDocxScope(): DocxScope {
  const id = randomId();
  // A letter first, so the prefixed classes are valid CSS identifiers.
  const prefix = `rca-${id}-`;
  return {
    id,
    selector: `[data-rca-docx=${cssString(id)}]`,
    idPrefix: prefix,
    documentPrefix: `${prefix}docx-`,
    pagePrefix: `${prefix}page-`,
  };
}

/** The class of one of `PaginatedDocument`'s elements in this scope. */
export function pageClass(
  scope: DocxScope,
  part: "container" | "staging" | "box" | "number"
): string {
  return `${scope.pagePrefix}${part}`;
}

// ---------------------------------------------------------------------------
// HTML
// ---------------------------------------------------------------------------

const PAGINATION_IDS = new Set(["pagination-staging", "pagination-container"]);

/** A document made its annotator's own. */
export interface IsolatedDocument {
  /** The HTML, without its stylesheets. */
  html: string;
  /** Its stylesheets as one, scoped and reduced to what the allow-list keeps. */
  css: string;
  /**
   * True when that stylesheet was dropped: a block could nest too deep to
   * be parsed, or the result failed its validation.
   */
  cssRejected: boolean;
}

/**
 * The (sanitised) document HTML made the scope's own: its `<style>` blocks
 * taken out and returned as one scoped stylesheet, its inline styles
 * cleaned, its ids prefixed and the links to them following. `parse` is the
 * browser's CSS parser (see `scopeStylesheets`).
 */
export function isolateDocument(
  html: string,
  scope: DocxScope,
  parse?: CssParser
): IsolatedDocument {
  const template = document.createElement("template");
  template.innerHTML = html;
  const { content } = template;

  const sheets = Array.from(content.querySelectorAll("style"), (style) => {
    style.remove();
    return style.textContent ?? "";
  });
  const { css, rejected } = scopeStylesheets(sheets, scope.selector, parse);

  for (const element of Array.from(content.querySelectorAll("[style]"))) {
    cleanInlineStyle(element);
  }

  for (const element of Array.from(content.querySelectorAll("[id]"))) {
    if (PAGINATION_IDS.has(element.id)) element.removeAttribute("id");
    else element.id = `${scope.idPrefix}${element.id}`;
  }
  for (const link of Array.from(content.querySelectorAll('[href^="#"]'))) {
    const target = (link.getAttribute("href") ?? "").slice(1);
    if (target !== "") link.setAttribute("href", `#${scope.idPrefix}${target}`);
  }

  return { html: template.innerHTML, css, cssRejected: rejected };
}
