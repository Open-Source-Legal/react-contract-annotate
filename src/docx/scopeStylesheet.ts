/**
 * Scopes a converted document's stylesheets to its annotator (spec
 * "Isolation"), and cleans its inline styles. The document is not trusted:
 * a crafted DOCX controls text docxodus writes into its CSS unescaped.
 *
 * What is kept is decided by an allow-list (`cssAllowList.ts`): the
 * properties a document may set and the plain values they may have. The
 * guarantee rests on two things, and on nothing else:
 *
 * 1. Only allow-listed declarations are written. Each `<style>` block is
 *    parsed by the browser's own parser (in a detached document) and
 *    rewritten from its parsed rules:
 *    - a style rule's selectors (`selectorText`) are put under the scope
 *      element; `html`, `body` and `:root` stand for that element. A rule
 *      whose selector list is not plain text, a selector that starts with a
 *      combinator or uses `&`, and a rule with nested rules are dropped;
 *    - its declarations are written one by one from `getPropertyValue` /
 *      `getPropertyPriority`, those the allow-list keeps only;
 *    - rules inside `@media`, `@supports` and `@container` are rewritten the
 *      same way, under the parsed condition, when the condition passes the
 *      value grammar. Every other at-rule is dropped: `@page`,
 *      `@font-face`, `@keyframes`, `@layer`, `@property`, `@namespace`,
 *      `@import` and the rest act on the whole page by name or position, or
 *      fetch.
 *
 * 2. The stylesheet inserted is the one validated. The rewritten blocks are
 *    joined, and that final text is parsed again with the same parser. It
 *    must hold, at every level, exactly the rules written, of the kinds
 *    written (style rules, `@media`, `@supports`, `@container`); every
 *    condition must pass the value grammar; every style rule must be
 *    without nested rules, every one of its selectors the scope element or
 *    inside it, and every one of its declarations must pass the allow-list
 *    again. So whatever a parser makes of the text written (a parser does
 *    not always serialise what it parsed into text that parses back the
 *    same way), a rule outside the scope or a declaration off the
 *    allow-list in the result rejects all of it: the document is then shown
 *    with the library's own (scoped) styles only.
 *
 * What this does not do:
 * - It does not stop a document styling what is inside its own scope
 *   element: its content (hiding it, moving it inside the viewer) and the
 *   annotations projected onto it, which are elements there too.
 * - It does not contain what a kept declaration does by itself: an
 *   absolutely positioned or oversized element, a high `z-index`, list
 *   items (`display: list-item`) that count in a list of the host's. That
 *   is the frame `DocxView` puts around the scope element.
 * - A kept `font-family` can name a font the host page declared, which the
 *   browser then loads from the host's own URL.
 * - Of what the browser's parser does with the document's text before any
 *   rule is returned, it bounds one thing, in one place: how deep the
 *   parser nests when this module parses a `<style>` block. A block with
 *   more than `MAX_CSS_NESTING_OPENERS` of `{` or of `(` is not parsed (see
 *   that constant for why and for the depths measured), and the whole
 *   document stylesheet is then dropped as rejected. It does not bound the
 *   parser's time or memory. It bounds nothing outside this module's own
 *   parsing: `DOMPurify.sanitize`, which the loader runs first, builds the
 *   document's `<style>` blocks into stylesheets while it parses the HTML,
 *   and the browser parses a `style` attribute as soon as any HTML parser
 *   makes the element (in DOMPurify, and in the template `isolateDocument`
 *   reads the HTML into), before `cleanInlineStyle` can look at it.
 *
 * Inline `style` attributes (`cleanInlineStyle`) are parsed by the browser
 * on their element (which stands in a template, so nothing is applied or
 * fetched), rewritten from the declarations the allow-list keeps, and the
 * attribute written is validated the same way; it is removed when nothing
 * is left or the validation fails.
 */
import { MAX_CSS_NESTING_OPENERS } from "./constants";
import {
  isAllowedDeclaration,
  isSafeSelectorList,
  isSafeValue,
} from "./cssAllowList";

/**
 * Parses a stylesheet with the browser's own CSS parser into its top-level
 * rules; null when the environment cannot.
 */
export type CssParser = (css: string) => ArrayLike<CSSRule> | null;

/**
 * Parses `css` in a `<style>` of a detached document: never applied to any
 * page, and nothing it names is fetched. (A constructable `CSSStyleSheet`
 * would do too, but `replaceSync` warns on the console about any `@import`
 * in its input.)
 */
export const parseInDetachedDocument: CssParser = (css) => {
  const detached = document.implementation.createHTMLDocument("");
  const style = detached.createElement("style");
  style.textContent = css;
  detached.head.append(style);
  return style.sheet ? Array.from(style.sheet.cssRules) : null;
};

const OPEN_BRACE = "{".charCodeAt(0);
const OPEN_PARENTHESIS = "(".charCodeAt(0);

/**
 * Whether `text` could nest deeper than document CSS may: it holds more
 * than `MAX_CSS_NESTING_OPENERS` of `{` or of `(`. A count only: nothing
 * closes a level, whatever follows.
 */
function nestsTooDeep(text: string): boolean {
  let braces = 0;
  let parentheses = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code === OPEN_BRACE) braces++;
    else if (code === OPEN_PARENTHESIS) parentheses++;
    else continue;
    if (Math.max(braces, parentheses) > MAX_CSS_NESTING_OPENERS) return true;
  }
  return false;
}

type GroupKind = "CSSMediaRule" | "CSSSupportsRule" | "CSSContainerRule";
type RuleKind = "CSSStyleRule" | GroupKind;

/** Whether `rule` is one of the window's `kind` rules (none if it has none). */
function ruleIs<T extends CSSRule>(rule: CSSRule, kind: RuleKind): rule is T {
  const constructor = (globalThis as Record<string, unknown>)[kind];
  return typeof constructor === "function" && rule instanceof constructor;
}

// ---------------------------------------------------------------------------
// Selectors
// ---------------------------------------------------------------------------

/**
 * Splits a parser-normalised selector list at its top-level commas (outside
 * parentheses, brackets and strings); null when the text is not plain (see
 * `isSafeSelectorList`: no escapes, so a string ends at its next quote) or
 * not balanced.
 */
function splitSelectorList(list: string): string[] | null {
  if (!isSafeSelectorList(list)) return null;
  const parts: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let from = 0;
  for (let i = 0; i < list.length; i++) {
    const char = list[i];
    if (quote !== null) {
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

/** Whether a (plain) selector uses the nesting selector `&` outside strings. */
function usesNesting(selector: string): boolean {
  let quote: string | null = null;
  for (const char of selector) {
    if (quote !== null) {
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
  if (rest === "" || /^[>+~@|]/.test(rest) || usesNesting(rest)) return null;
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

/** Whether every selector of a parsed list is the scope element or inside it. */
function isScopedList(list: string, scope: string): boolean {
  const selectors = splitSelectorList(list);
  return (
    selectors !== null &&
    selectors.every((raw) => {
      const selector = raw.trim();
      if (selector === scope) return true;
      if (!selector.startsWith(`${scope} `)) return false;
      // A descendant or child of the scope element, not a sibling, and
      // nothing that refers back to an enclosing rule.
      return (
        !/^[+~|]/.test(selector.slice(scope.length).trimStart()) &&
        !usesNesting(selector)
      );
    })
  );
}

// ---------------------------------------------------------------------------
// Declarations
// ---------------------------------------------------------------------------

/** The value of the declaration of `name`, as the parser returns it. */
function valueOf(style: CSSStyleDeclaration, name: string): string {
  return style.getPropertyValue(name).trim();
}

/** The declarations of `style` the allow-list keeps, written one by one. */
function keptDeclarations(style: CSSStyleDeclaration): string[] {
  const out: string[] = [];
  // Indexed: jsdom's rule declarations have no `item()`.
  for (let i = 0; i < style.length; i++) {
    const name = style[i];
    const value = valueOf(style, name);
    if (!isAllowedDeclaration(name, value)) continue;
    const important =
      style.getPropertyPriority(name) === "important" ? " !important" : "";
    out.push(`${name}: ${value}${important};`);
  }
  return out;
}

/** Whether the allow-list keeps every declaration of (parsed) `style`. */
function hasOnlyAllowedDeclarations(style: CSSStyleDeclaration): boolean {
  for (let i = 0; i < style.length; i++) {
    const name = style[i];
    if (!isAllowedDeclaration(name, valueOf(style, name))) return false;
  }
  return true;
}

/**
 * Cleans an element's inline `style` (see the module comment): keeps the
 * declarations the allow-list keeps, validates the attribute written, and
 * removes it when none is left or it does not parse back to allowed
 * declarations only.
 */
export function cleanInlineStyle(element: Element): void {
  const { style } = element as Element & Partial<ElementCSSInlineStyle>;
  const kept = style ? keptDeclarations(style) : [];
  if (!style || kept.length === 0) {
    element.removeAttribute("style");
    return;
  }
  element.setAttribute("style", kept.join(" "));
  if (style.length !== kept.length || !hasOnlyAllowedDeclarations(style)) {
    element.removeAttribute("style");
  }
}

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

/** The shape of a rule written: what parsing the stylesheet must give back. */
type Planned =
  { kind: "CSSStyleRule" } | { kind: GroupKind; children: Planned[] };

type Written = { text: string; plan: Planned };

/** The kept grouping rules: their kind, at-keyword and parsed condition. */
const GROUPS: readonly [GroupKind, string, (rule: CSSRule) => string][] = [
  ["CSSMediaRule", "@media", (rule) => (rule as CSSMediaRule).media.mediaText],
  [
    "CSSSupportsRule",
    "@supports",
    (rule) => (rule as CSSSupportsRule).conditionText,
  ],
  [
    "CSSContainerRule",
    "@container",
    (rule) => (rule as CSSConditionRule).conditionText,
  ],
];

/**
 * How deep kept grouping rules may nest; deeper ones are dropped. docxodus
 * nests none (`@media print { … }`), and a bound keeps this module's own
 * recursion shallow whatever the document nests.
 */
const MAX_GROUP_DEPTH = 8;

/**
 * The kept rules of `rules`, scoped, built from their parsed parts; `depth`
 * is the number of grouping rules around them.
 */
function scopeRules(
  rules: ArrayLike<CSSRule>,
  scope: string,
  depth = 0
): Written[] {
  const out: Written[] = [];
  for (const rule of Array.from(rules)) {
    if (ruleIs<CSSStyleRule>(rule, "CSSStyleRule")) {
      // Nested rules (CSS nesting) would be relative to this one's selector.
      if ((rule.cssRules?.length ?? 0) > 0) continue;
      const selectors = scopeSelectorList(rule.selectorText, scope);
      const kept = keptDeclarations(rule.style);
      if (selectors !== null && kept.length > 0) {
        out.push({
          text: `${selectors} { ${kept.join(" ")} }`,
          plan: { kind: "CSSStyleRule" },
        });
      }
      continue;
    }
    const group = GROUPS.find(([kind]) => ruleIs(rule, kind));
    if (!group || depth >= MAX_GROUP_DEPTH) continue; // every other at-rule
    const [kind, keyword, conditionOf] = group;
    const condition = conditionOf(rule).trim();
    if (!isSafeValue(condition)) continue;
    const inner = scopeRules(
      (rule as CSSGroupingRule).cssRules,
      scope,
      depth + 1
    );
    if (inner.length === 0) continue;
    out.push({
      text: `${keyword} ${condition} {\n${inner.map((w) => w.text).join("\n")}\n}`,
      plan: { kind, children: inner.map((w) => w.plan) },
    });
  }
  return out;
}

/**
 * Whether parsed `rules` are exactly `plans`, with every condition passing
 * the value grammar, every selector scoped and every declaration allowed.
 */
function conforms(
  rules: ArrayLike<CSSRule>,
  plans: readonly Planned[],
  scope: string
): boolean {
  const list = Array.from(rules);
  return (
    list.length === plans.length &&
    list.every((rule, index) => {
      const plan = plans[index];
      if (plan.kind === "CSSStyleRule") {
        return (
          ruleIs<CSSStyleRule>(rule, "CSSStyleRule") &&
          (rule.cssRules?.length ?? 0) === 0 &&
          isScopedList(rule.selectorText, scope) &&
          hasOnlyAllowedDeclarations(rule.style)
        );
      }
      const group = GROUPS.find(([kind]) => kind === plan.kind);
      return (
        group !== undefined &&
        ruleIs(rule, plan.kind) &&
        isSafeValue(group[2](rule).trim()) &&
        conforms((rule as CSSGroupingRule).cssRules, plan.children, scope)
      );
    })
  );
}

export interface ScopedStylesheet {
  css: string;
  /**
   * True when nothing of the stylesheet is kept: a block could nest too
   * deep to be parsed, or the result failed its validation.
   */
  rejected: boolean;
}

/**
 * The stylesheets `sheets` (the text of each `<style>` block of a document)
 * as one stylesheet scoped to `scope` (a selector): each rewritten from its
 * parsed rules, the result joined and validated by parsing it (see the
 * module comment). Empty when a block cannot be parsed. Empty and
 * `rejected` when the validation fails, or when a block could nest too deep
 * (`nestsTooDeep`): then no block is parsed at all. `parse` is the
 * browser's parser.
 */
export function scopeStylesheets(
  sheets: readonly string[],
  scope: string,
  parse: CssParser = parseInDetachedDocument
): ScopedStylesheet {
  // Before any parse: this is where document CSS first reaches the parser.
  if (sheets.some(nestsTooDeep)) return { css: "", rejected: true };
  const written: Written[] = [];
  for (const sheet of sheets) {
    const rules = parse(sheet);
    if (rules === null) return { css: "", rejected: false };
    written.push(...scopeRules(rules, scope));
  }
  const css = written.map((w) => w.text).join("\n");
  if (css === "") return { css, rejected: false };
  const reparsed = parse(css);
  const valid =
    reparsed !== null &&
    conforms(
      reparsed,
      written.map((w) => w.plan),
      scope
    );
  return valid ? { css, rejected: false } : { css: "", rejected: true };
}
