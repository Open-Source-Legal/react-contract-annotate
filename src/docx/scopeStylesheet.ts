/**
 * Scopes a converted document's stylesheet to its annotator (spec
 * "Isolation"), and cleans its inline styles.
 *
 * 1. The CSS is parsed by the browser's own parser (in a detached document)
 *    and a new stylesheet is built from the parsed rules:
 *    - a style rule's selectors (`selectorText`) are put under the scope
 *      element; `html`, `body` and `:root` stand for that element; a
 *      selector that starts with a combinator or uses `&`, and a rule with
 *      nested rules, are dropped;
 *    - its declarations are written one by one from `getPropertyValue` /
 *      `getPropertyPriority`. Dropped: custom properties (`--*`) other than
 *      the ones the caller names, which must hold a number; values that
 *      still hold source text (`var()`) unless made only of plain
 *      characters; and anything that would fetch (`url()` other than a
 *      `data:` URI, `src()`, `image()`, `image-set()`, `cross-fade()`,
 *      `element()`);
 *    - rules inside `@media`, `@supports` and `@container` are rewritten the
 *      same way, under the parsed condition. Every other at-rule is dropped:
 *      `@page`, `@font-face`, `@keyframes`, `@layer`, `@property`,
 *      `@namespace` and `@import` act on the whole page by name or position,
 *      or fetch.
 *
 *    A parser does not always serialise what it parsed into text that parses
 *    back the same way (Chromium writes a custom property's value, or a
 *    value holding `var()`, as its source text, unterminated string and
 *    all). So step 1 reduces what can go wrong; it is not the boundary.
 *
 * 2. The security boundary: the stylesheet built is parsed again, with the
 *    same parser, and must be exactly what was meant to be written: the same
 *    number of rules at every level, of the same kinds (style rules,
 *    `@media`, `@supports`, `@container`), every style rule without nested
 *    rules and with every selector the scope element or inside it. On any
 *    difference the whole stylesheet is rejected: the document is shown
 *    with the library's own (scoped) styles only.
 *
 * Inline `style` attributes (`cleanInlineStyle`) keep the declarations that
 * neither fetch nor are custom properties (other than the named ones), and
 * no `position: fixed` or `sticky`.
 */

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

/** Whether every selector of a parsed list is the scope element or inside it. */
function isScopedList(list: string, scope: string): boolean {
  const selectors = splitSelectorList(list);
  return (
    selectors !== null &&
    selectors.every((raw) => {
      const selector = raw.trim();
      if (selector === scope) return true;
      if (!selector.startsWith(`${scope} `)) return false;
      // A descendant or child of the scope element, not a sibling.
      return !/^[+~]/.test(selector.slice(scope.length).trimStart());
    })
  );
}

// ---------------------------------------------------------------------------
// Declarations
// ---------------------------------------------------------------------------

/** A CSS function that fetches (or shows other content), by name. */
const FETCHING_FUNCTION =
  /(?:^|[^\w-])(?:-webkit-)?(url|src|image-set|image|cross-fade|element)\(\s*(["']?)/gi;

/** Whether a (parsed) value would fetch anything but a `data:` URI. */
export function fetchesExternally(value: string): boolean {
  for (const match of value.matchAll(FETCHING_FUNCTION)) {
    const name = match[1].toLowerCase();
    const after = value.slice((match.index ?? 0) + match[0].length);
    if ((name === "url" || name === "src") && /^data:/i.test(after)) continue;
    return true;
  }
  return false;
}

/** The characters a value holding `var()` (kept as source text) may use. */
const PLAIN_VALUE = /^[\w\s().,*+/%-]+$/;
/** The value a kept custom property must have. */
const NUMBER = /^-?(?:\d+\.?\d*|\.\d+)$/;

/** Whether one declaration may be written. */
function keepDeclaration(
  name: string,
  value: string,
  customProperties: ReadonlySet<string>
): boolean {
  if (value === "") return false;
  if (name.startsWith("--")) {
    return customProperties.has(name) && NUMBER.test(value);
  }
  if (/var\(/i.test(value) && !PLAIN_VALUE.test(value)) return false;
  return !fetchesExternally(value);
}

/** The declarations of `style` that may be written, one by one. */
function declarations(
  style: CSSStyleDeclaration,
  customProperties: ReadonlySet<string>
): string[] {
  const out: string[] = [];
  for (let i = 0; i < style.length; i++) {
    const name = style[i];
    const value = style.getPropertyValue(name).trim();
    if (!keepDeclaration(name, value, customProperties)) continue;
    const important =
      style.getPropertyPriority(name) === "important" ? " !important" : "";
    out.push(`${name}: ${value}${important};`);
  }
  return out;
}

/**
 * Cleans an element's inline `style`: keeps the declarations a stylesheet
 * would (see `keepDeclaration`), without `position: fixed` or `sticky`, and
 * removes the attribute when none is left.
 */
export function cleanInlineStyle(
  element: HTMLElement,
  customProperties: ReadonlySet<string>
): void {
  const kept = declarations(element.style, customProperties).filter(
    (declaration) => !/^position:\s*(?:fixed|sticky)\b/i.test(declaration)
  );
  if (kept.length > 0) element.setAttribute("style", kept.join(" "));
  else element.removeAttribute("style");
}

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

/** The shape of a rule written: what parsing the stylesheet must give back. */
type Planned =
  { kind: "CSSStyleRule" } | { kind: GroupKind; children: Planned[] };

type Written = { text: string; plan: Planned };

const GROUPS: readonly [GroupKind, (rule: CSSRule) => string][] = [
  [
    "CSSMediaRule",
    (rule) => `@media ${(rule as CSSMediaRule).media.mediaText}`,
  ],
  [
    "CSSSupportsRule",
    (rule) => `@supports ${(rule as CSSSupportsRule).conditionText}`,
  ],
  [
    "CSSContainerRule",
    (rule) => `@container ${(rule as CSSConditionRule).conditionText}`,
  ],
];

/** The kept rules of `rules`, scoped, built from their parsed parts. */
function scopeRules(
  rules: ArrayLike<CSSRule>,
  scope: string,
  customProperties: ReadonlySet<string>
): Written[] {
  const out: Written[] = [];
  for (const rule of Array.from(rules)) {
    if (ruleIs<CSSStyleRule>(rule, "CSSStyleRule")) {
      // Nested rules (CSS nesting) would be relative to this one's selector.
      if ((rule.cssRules?.length ?? 0) > 0) continue;
      const selectors = scopeSelectorList(rule.selectorText, scope);
      const kept = declarations(rule.style, customProperties);
      if (selectors !== null && kept.length > 0) {
        out.push({
          text: `${selectors} { ${kept.join(" ")} }`,
          plan: { kind: "CSSStyleRule" },
        });
      }
      continue;
    }
    const group = GROUPS.find(([kind]) => ruleIs(rule, kind));
    if (!group) continue; // every other at-rule
    const [kind, condition] = group;
    const inner = scopeRules(
      (rule as CSSGroupingRule).cssRules,
      scope,
      customProperties
    );
    if (inner.length === 0) continue;
    out.push({
      text: `${condition(rule)} {\n${inner.map((w) => w.text).join("\n")}\n}`,
      plan: { kind, children: inner.map((w) => w.plan) },
    });
  }
  return out;
}

/** Whether parsed `rules` are exactly `plans`, every selector scoped. */
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
          isScopedList(rule.selectorText, scope)
        );
      }
      return (
        ruleIs(rule, plan.kind) &&
        conforms((rule as CSSGroupingRule).cssRules, plan.children, scope)
      );
    })
  );
}

export interface ScopeOptions {
  /**
   * Custom properties kept (with a number for value); every other `--*`
   * declaration is dropped.
   */
  customProperties?: ReadonlySet<string>;
  /** The browser's parser; `parseInDetachedDocument` by default. */
  parse?: CssParser;
}

export interface ScopedStylesheet {
  css: string;
  /** True when the stylesheet failed the check and nothing of it is kept. */
  rejected: boolean;
}

const NO_CUSTOM_PROPERTIES: ReadonlySet<string> = new Set();

/**
 * `css` scoped to `scope` (a selector), built from its parsed rules and
 * checked by parsing the result (see the module comment). Empty when it
 * cannot be parsed, and empty and `rejected` when the check fails.
 */
export function scopeStylesheet(
  css: string,
  scope: string,
  {
    customProperties = NO_CUSTOM_PROPERTIES,
    parse = parseInDetachedDocument,
  }: ScopeOptions = {}
): ScopedStylesheet {
  const rules = parse(css);
  if (rules === null) return { css: "", rejected: false };
  const written = scopeRules(rules, scope, customProperties);
  const text = written.map((w) => w.text).join("\n");
  const reparsed = text === "" ? [] : parse(text);
  const valid =
    reparsed !== null &&
    conforms(
      reparsed,
      written.map((w) => w.plan),
      scope
    );
  return valid ? { css: text, rejected: false } : { css: "", rejected: true };
}
