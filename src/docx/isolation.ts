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
 *   under the scope (`scopeStylesheet`). The CSS is parsed by the browser's
 *   own parser (in a detached document) and written back only from the
 *   parsed rules: nothing of the input text is copied through, so a crafted
 *   document (a font name with a line break in it, an unquoted `url(`)
 *   cannot open a rule of its own. Each style rule's selectors
 *   (`selectorText`) are put under the scope element, and `html`, `body`
 *   and `:root` stand for that element; a selector that starts with a
 *   combinator or uses `&`, and a rule with nested rules, are dropped. Its
 *   declarations are the parser's (`style.cssText`). Rules inside `@media`,
 *   `@supports` and `@container` are rewritten the same way, under the
 *   parsed condition. Every other at-rule is dropped: `@page`,
 *   `@font-face`, `@keyframes`, `@layer`, `@property`, `@namespace` and
 *   `@import` act on the whole page by name or position.
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
 * Parses a stylesheet with the browser's own CSS parser into its top-level
 * rules; null when the environment cannot.
 */
export type CssParser = (css: string) => ArrayLike<CSSRule> | null;

/**
 * Parses `css` in a `<style>` of a detached document: never applied to any
 * page. (A constructable `CSSStyleSheet` would do too, but `replaceSync`
 * warns on the console about any `@import` in its input.)
 */
export const parseInDetachedDocument: CssParser = (css) => {
  const detached = document.implementation.createHTMLDocument("");
  const style = detached.createElement("style");
  style.textContent = css;
  detached.head.append(style);
  return style.sheet ? Array.from(style.sheet.cssRules) : null;
};

type RuleConstructor =
  "CSSStyleRule" | "CSSMediaRule" | "CSSSupportsRule" | "CSSContainerRule";

/** Whether `rule` is one of the window's `name` rules (none if it has none). */
function ruleIs<T extends CSSRule>(
  rule: CSSRule,
  name: RuleConstructor
): rule is T {
  const constructor = (globalThis as Record<string, unknown>)[name];
  return typeof constructor === "function" && rule instanceof constructor;
}

/**
 * Splits a parser-normalised selector list at its top-level commas
 * (outside parentheses, brackets, strings and escapes); null when the text
 * is not balanced.
 */
function splitSelectorList(list: string): string[] | null {
  const parts: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let from = 0;
  for (let i = 0; i < list.length; i++) {
    const char = list[i];
    if (char === "\\") {
      i++;
    } else if (quote !== null) {
      if (char === quote) quote = null;
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === "(" || char === "[") {
      depth++;
    } else if (char === ")" || char === "]") {
      if (--depth < 0) return null;
    } else if (char === "," && depth === 0) {
      parts.push(list.slice(from, i));
      from = i + 1;
    }
  }
  if (quote !== null || depth !== 0) return null;
  parts.push(list.slice(from));
  return parts;
}

/** Whether a selector uses the nesting selector `&` (outside strings). */
function usesNesting(selector: string): boolean {
  let quote: string | null = null;
  for (let i = 0; i < selector.length; i++) {
    const char = selector[i];
    if (char === "\\") i++;
    else if (quote !== null) {
      if (char === quote) quote = null;
    } else if (char === '"' || char === "'") quote = char;
    else if (char === "&") return true;
  }
  return false;
}

/** A leading `html`, `body` or `:root` compound, with what follows it. */
const ROOT_COMPOUND = /^(?:html|body|:root)(?=$|[\s>+~])\s*/i;

/**
 * One parser-normalised complex selector under `scope`: the scope element
 * itself, or something inside it. Null when it could match anything else:
 * one that starts with a combinator or uses `&`, or a sibling of `body`.
 */
function scopeSelector(selector: string, scope: string): string | null {
  let rest = selector.trim();
  if (rest === "" || /^[>+~@]/.test(rest) || usesNesting(rest)) return null;
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

/**
 * A parser-normalised selector list under `scope`; null when none of it can
 * stay, or when the list cannot be split with confidence.
 */
export function scopeSelectorList(list: string, scope: string): string | null {
  const selectors = splitSelectorList(list);
  if (selectors === null) return null;
  const scoped = selectors.flatMap((selector) => {
    const result = scopeSelector(selector, scope);
    return result === null ? [] : [result];
  });
  return scoped.length > 0 ? scoped.join(", ") : null;
}

/** The kept rules of `rules`, scoped, serialised from their parsed parts. */
function scopeRules(rules: ArrayLike<CSSRule>, scope: string): string[] {
  const out: string[] = [];
  for (const rule of Array.from(rules)) {
    if (ruleIs<CSSStyleRule>(rule, "CSSStyleRule")) {
      // Nested rules (CSS nesting) would be relative to this one's selector.
      if ((rule.cssRules?.length ?? 0) > 0) continue;
      const declarations = rule.style.cssText;
      const selectors = scopeSelectorList(rule.selectorText, scope);
      if (selectors !== null && declarations !== "") {
        out.push(`${selectors} { ${declarations} }`);
      }
      continue;
    }
    let condition: string | null = null;
    if (ruleIs<CSSMediaRule>(rule, "CSSMediaRule")) {
      condition = `@media ${rule.media.mediaText}`;
    } else if (ruleIs<CSSSupportsRule>(rule, "CSSSupportsRule")) {
      condition = `@supports ${rule.conditionText}`;
    } else if (ruleIs<CSSConditionRule>(rule, "CSSContainerRule")) {
      condition = `@container ${rule.conditionText}`;
    }
    if (condition === null) continue; // every other at-rule
    const inner = scopeRules((rule as CSSGroupingRule).cssRules, scope);
    if (inner.length > 0) out.push(`${condition} {\n${inner.join("\n")}\n}`);
  }
  return out;
}

/**
 * `css` scoped to `scope` (a selector): parsed by `parse` (the browser's own
 * parser) and written back from the parsed rules only. Empty when it cannot
 * be parsed.
 */
export function scopeStylesheet(
  css: string,
  scope: string,
  parse: CssParser = parseInDetachedDocument
): string {
  const rules = parse(css);
  return rules === null ? "" : scopeRules(rules, scope).join("\n");
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
  scope: DocxScope,
  parse: CssParser = parseInDetachedDocument
): { html: string; css: string } {
  const template = document.createElement("template");
  template.innerHTML = html;
  const { content } = template;

  const css = Array.from(content.querySelectorAll("style"), (style) => {
    style.remove();
    return scopeStylesheet(style.textContent ?? "", scope.selector, parse);
  })
    .filter((sheet) => sheet !== "")
    .join("\n");

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
