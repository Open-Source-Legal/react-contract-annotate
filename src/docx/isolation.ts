/**
 * Keeps a converted document to its own annotator (spec "Isolation"): its
 * stylesheet must not restyle the host page or another annotator, it cannot
 * make the browser fetch a URL of its choosing, the host's class names must
 * not collide with the document's, its element ids must not repeat across
 * annotators, and its links cannot navigate the host page.
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
 *   (`href="#…"`) follow them. The ids docxodus gives the pagination's
 *   staging and page containers are removed (the pagination finds them by
 *   class).
 * - Every link opens in a new tab with `rel="noopener noreferrer"`; the view
 *   intercepts clicks on them (`DocxView`).
 * - A `src` is kept only when it is a `data:` URL of an image. (The
 *   sanitiser, `htmlAllowList.ts`, has already dropped every other element
 *   and attribute that names a URL, but for links.)
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
   * `paginationCssClassPrefix` and the pagination's `cssPrefix`.
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

/** The class of one of the pagination's elements in this scope. */
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

/** The scheme of a URL whose content is in the URL itself. */
const DATA_PROTOCOL = "data:";
/** The start of the media type of an image. */
const IMAGE_MEDIA_TYPE = /^image\//i;

/**
 * Whether `src` is a `data:` URL of an image, read by the browser's URL
 * parser as the browser reads it when it loads the image.
 */
function isImageData(src: string): boolean {
  try {
    const url = new URL(src);
    return url.protocol === DATA_PROTOCOL && IMAGE_MEDIA_TYPE.test(url.pathname);
  } catch {
    return false; // relative, or not a URL
  }
}

/** A document made its annotator's own. */
export interface IsolatedDocument {
  /** The HTML, without its stylesheets. */
  html: string;
  /** Its stylesheets as one, scoped and reduced to what the allow-list keeps. */
  css: string;
  /** True when that stylesheet failed its validation and was dropped. */
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

  // Every id is prefixed, the registries docxodus' pagination finds by id
  // (`#pagination-hf-registry`, `#pagination-footnote-registry`,
  // `#pagination-comment-margin-registry`) included. That is latent: the
  // documents are converted without headers, footers, footnotes or margin
  // comments, so there are none; converting with them would need those ids
  // kept as they are (or the pagination told the prefixed ones).
  for (const element of Array.from(content.querySelectorAll("[id]"))) {
    if (PAGINATION_IDS.has(element.id)) element.removeAttribute("id");
    else element.id = `${scope.idPrefix}${element.id}`;
  }
  // Same-document links follow the prefixed ids. Nothing else that names an
  // id is made to follow them: `popovertarget` and its kind are dropped by
  // the sanitiser, and one that followed could open a popover in the top
  // layer, above the frame and the host's page.
  for (const link of Array.from(content.querySelectorAll('[href^="#"]'))) {
    const target = (link.getAttribute("href") ?? "").slice(1);
    if (target !== "") link.setAttribute("href", `#${scope.idPrefix}${target}`);
  }
  // A link opens in a new tab with neither opener nor referrer, whatever the
  // document said: a click that `DocxView` does not intercept (a middle
  // click, "open in new tab") cannot navigate the host page either.
  for (const link of Array.from(content.querySelectorAll("a[href]"))) {
    link.setAttribute("target", "_blank");
    link.setAttribute("rel", "noopener noreferrer");
  }
  // An image is shown from its own bytes or not at all: the browser fetches
  // nothing for it.
  for (const element of Array.from(content.querySelectorAll("[src]"))) {
    if (!isImageData(element.getAttribute("src") ?? "")) {
      element.removeAttribute("src");
    }
  }

  return { html: template.innerHTML, css, cssRejected: rejected };
}
