/**
 * Keeps a converted document to its own annotator (spec "Isolation"): its
 * stylesheet must not restyle the host page or another annotator, the host's
 * class names must not collide with the document's, and its element ids must
 * not repeat across annotators.
 *
 * - Every annotator gets a random scope (`createDocxScope`), unique across
 *   React roots: the value of its `[data-rca-docx]` attribute, and the root
 *   of the class prefixes docxodus is asked to use for the document's classes
 *   and the pagination elements, so they are the annotator's own.
 * - The document's `<style>` blocks are taken out of its HTML and rewritten
 *   under the scope (`scopeStylesheet`): each selector is prefixed with the
 *   scope's element, and `html`, `body` and `:root` stand for that element.
 *   Rules inside `@media` / `@supports` are rewritten the same way. Every
 *   other at-rule is dropped: `@page`, `@font-face`, `@keyframes`, `@layer`,
 *   `@property` and `@import` act on the whole page by name or position. The
 *   declarations are kept as written.
 * - Element ids are prefixed with the scope, and same-document links
 *   (`href="#…"`) follow them. The ids `PaginatedDocument` gives its
 *   staging and page containers are removed (it finds them by class).
 */
import { cssString } from "./cssString";

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
// Stylesheet
// ---------------------------------------------------------------------------

/**
 * Index just past the string, comment or escape starting at `at`, or `at`
 * when none starts there.
 */
function skipToken(css: string, at: number): number {
  const char = css[at];
  if (char === "\\") return Math.min(at + 2, css.length);
  if (char === "/" && css[at + 1] === "*") {
    const close = css.indexOf("*/", at + 2);
    return close < 0 ? css.length : close + 2;
  }
  if (char === '"' || char === "'") {
    let i = at + 1;
    while (i < css.length && css[i] !== char) {
      i += css[i] === "\\" ? 2 : 1;
    }
    return Math.min(i + 1, css.length);
  }
  return at;
}

/** `text` without its comments. */
function withoutComments(text: string): string {
  let out = "";
  for (let i = 0; i < text.length;) {
    const next = skipToken(text, i);
    if (next > i) {
      if (!text.startsWith("/*", i)) out += text.slice(i, next);
      i = next;
    } else {
      out += text[i++];
    }
  }
  return out;
}

/**
 * Splits `text` at the top-level occurrences of `separator` (outside
 * strings, comments, parentheses and brackets).
 */
function splitTopLevel(text: string, separator: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let from = 0;
  for (let i = 0; i < text.length;) {
    const next = skipToken(text, i);
    if (next > i) {
      i = next;
      continue;
    }
    const char = text[i];
    if (char === "(" || char === "[") depth++;
    else if ((char === ")" || char === "]") && depth > 0) depth--;
    else if (char === separator && depth === 0) {
      parts.push(text.slice(from, i));
      from = i + 1;
    }
    i++;
  }
  parts.push(text.slice(from));
  return parts;
}

/** A leading `html`, `body` or `:root` compound, with what follows it. */
const ROOT_COMPOUND = /^(?:html|body|:root)(?=$|[\s>+~])\s*/i;

/**
 * One complex selector under `scope`, or null when it can only match outside
 * the scope (a sibling of `body`).
 */
function scopeSelector(selector: string, scope: string): string | null {
  let rest = selector.trim();
  if (rest === "") return null;
  let rooted = false;
  for (;;) {
    const match = ROOT_COMPOUND.exec(rest);
    if (!match) break;
    rooted = true;
    rest = rest.slice(match[0].length);
    // `html > body`: the child combinator belongs to the next compound.
    if (rest.startsWith(">") && ROOT_COMPOUND.test(rest.slice(1).trimStart())) {
      rest = rest.slice(1).trimStart();
    }
  }
  if (!rooted) return `${scope} ${rest}`;
  if (rest === "") return scope;
  if (rest.startsWith("+") || rest.startsWith("~")) return null;
  return `${scope} ${rest}`;
}

/** A selector list under `scope`; null when none of it can stay. */
export function scopeSelectorList(list: string, scope: string): string | null {
  const scoped = splitTopLevel(withoutComments(list), ",").flatMap(
    (selector) => {
      const result = scopeSelector(selector, scope);
      return result === null ? [] : [result];
    }
  );
  return scoped.length > 0 ? scoped.join(", ") : null;
}

/** At-rules whose rules are rewritten; every other at-rule is dropped. */
const GROUPING_AT_RULE = /^@(?:media|supports)\b/i;

/** The top-level rules of `css`: a prelude, and a block when it has one. */
function topLevelRules(
  css: string
): { prelude: string; block: string | null }[] {
  const rules: { prelude: string; block: string | null }[] = [];
  let from = 0;
  let depth = 0;
  let blockStart = -1;
  for (let i = 0; i < css.length;) {
    const next = skipToken(css, i);
    if (next > i) {
      i = next;
      continue;
    }
    const char = css[i];
    if (char === "{") {
      if (depth === 0) blockStart = i;
      depth++;
    } else if (char === "}" && depth > 0) {
      depth--;
      if (depth === 0) {
        rules.push({
          prelude: css.slice(from, blockStart),
          block: css.slice(blockStart + 1, i),
        });
        from = i + 1;
      }
    } else if (char === ";" && depth === 0) {
      rules.push({ prelude: css.slice(from, i), block: null });
      from = i + 1;
    }
    i++;
  }
  // An unterminated rule at the end is dropped, as a browser would.
  return rules;
}

/**
 * `css` with every rule scoped to `scope` (a selector): see the module
 * comment. Comments are dropped.
 */
export function scopeStylesheet(css: string, scope: string): string {
  const out: string[] = [];
  for (const { prelude, block } of topLevelRules(css)) {
    const head = withoutComments(prelude).trim();
    if (block === null || head === "") continue;
    if (head.startsWith("@")) {
      if (GROUPING_AT_RULE.test(head)) {
        out.push(`${head} {\n${scopeStylesheet(block, scope)}\n}`);
      }
      continue;
    }
    const selectors = scopeSelectorList(head, scope);
    if (selectors !== null) out.push(`${selectors} {${block}}`);
  }
  return out.join("\n");
}

// ---------------------------------------------------------------------------
// HTML
// ---------------------------------------------------------------------------

const PAGINATION_IDS = new Set(["pagination-staging", "pagination-container"]);

/**
 * The (sanitised) document HTML made the scope's own: its `<style>` blocks
 * taken out and returned scoped, its ids prefixed and the links to them
 * following.
 */
export function isolateDocument(
  html: string,
  scope: DocxScope
): { html: string; css: string } {
  const template = document.createElement("template");
  template.innerHTML = html;
  const { content } = template;

  const css = Array.from(content.querySelectorAll("style"), (style) => {
    style.remove();
    return scopeStylesheet(style.textContent ?? "", scope.selector);
  }).join("\n");

  for (const element of Array.from(content.querySelectorAll("[id]"))) {
    if (PAGINATION_IDS.has(element.id)) element.removeAttribute("id");
    else element.id = `${scope.idPrefix}${element.id}`;
  }
  for (const link of Array.from(content.querySelectorAll('[href^="#"]'))) {
    const target = (link.getAttribute("href") ?? "").slice(1);
    if (target !== "") link.setAttribute("href", `#${scope.idPrefix}${target}`);
  }

  return { html: template.innerHTML, css };
}
