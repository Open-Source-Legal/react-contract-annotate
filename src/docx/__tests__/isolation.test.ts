import {
  createDocxScope,
  isolateDocument,
  scopeSelectorList,
  scopeStylesheet,
} from "../isolation";
import { parseInJsdom } from "./jsdomCss";

// These check structure with jsdom's CSS parser (see `jsdomCss.ts`); the
// security regression tests run with Chromium's, in `ct-tests/docx.ct.tsx`.

const SCOPE = '[data-rca-docx="s1"]';

/** A stylesheet shaped like the one docxodus 12.4.1 puts in converted HTML. */
const DOCUMENT_CSS = `/* Document layout CSS — Word's layout invariants. */
body {
    overflow-wrap: break-word;
}
body, body * {
    -webkit-text-size-adjust: 100%;
}
table { max-width: 100%; }
td, th { overflow-wrap: anywhere; }
sup, sub { line-height: 0; }
body { font-family: Arial, sans-serif; margin: 0; } span { white-space: pre-wrap; }
p.docx-Normal { --docx-auto-line-spacing: 1.15; font-family: 'Cambria', serif; }
:root { --page-scale: 1.00; }
.page-staging { position: absolute; left: -9999px; visibility: hidden; }
.page-content { position: absolute; overflow: hidden; transform-origin: top left; }
html > body .page-box { background: white; }
body + div { color: red; }
a[title="x, y { }"] , em { color: blue; }
@media print {
    .page-container { background: none; }
    body { margin: 0; }
}
@page { size: 8.50in 11.00in; margin: 0; }
@font-face { font-family: "Arial"; src: url(evil.woff); }
@keyframes fade { from { opacity: 0 } }
@import url("other.css");
@supports (display: grid) { :root { --grid: 1; } }`;

/**
 * Each selector of each style rule a browser parses out of `css`, at any
 * depth, and the at-rules it keeps.
 */
function parse(css: string): { selectors: string[]; atRules: string[] } {
  const style = document.createElement("style");
  style.media = "not all"; // parsed, never applied
  style.textContent = css;
  document.head.append(style);
  try {
    const selectors: string[] = [];
    const atRules: string[] = [];
    const walk = (rules: CSSRuleList) => {
      for (const rule of Array.from(rules)) {
        if ("selectorText" in rule) {
          selectors.push(...splitSelectors(String(rule.selectorText)));
        } else {
          atRules.push(rule.cssText.slice(0, rule.cssText.indexOf("{")).trim());
          if ("cssRules" in rule) walk(rule.cssRules as CSSRuleList);
        }
      }
    };
    walk(style.sheet?.cssRules ?? ([] as unknown as CSSRuleList));
    return { selectors, atRules };
  } finally {
    style.remove();
  }
}

/** A selector list split at the commas outside strings and brackets. */
function splitSelectors(list: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let from = 0;
  for (let i = 0; i < list.length; i++) {
    const char = list[i];
    if (quote) {
      if (char === quote) quote = null;
    } else if (char === '"' || char === "'") quote = char;
    else if (char === "(" || char === "[") depth++;
    else if (char === ")" || char === "]") depth--;
    else if (char === "," && depth === 0) {
      parts.push(list.slice(from, i).trim());
      from = i + 1;
    }
  }
  parts.push(list.slice(from).trim());
  return parts;
}

test("no rule of the scoped document stylesheet can match outside the scope", () => {
  const { selectors, atRules } = parse(
    scopeStylesheet(DOCUMENT_CSS, SCOPE, parseInJsdom)
  );

  expect(selectors.length).toBeGreaterThan(10);
  for (const selector of selectors) {
    // The scope element itself, or something inside it.
    expect(selector === SCOPE || selector.startsWith(`${SCOPE} `)).toBe(true);
    expect(selector).not.toMatch(/^\[data-rca-docx="s1"\] [+~]/);
  }
  // Only conditional groups survive; @page, @font-face, @keyframes and
  // @import act on the whole page. (jsdom has no `CSSSupportsRule`, so its
  // `@supports` is dropped here; Chromium keeps it.)
  expect(atRules).toEqual(["@media print"]);
});

test("html, body and :root stand for the scope element", () => {
  expect(scopeSelectorList("body", SCOPE)).toBe(SCOPE);
  expect(scopeSelectorList(":root", SCOPE)).toBe(SCOPE);
  expect(scopeSelectorList("body, body *", SCOPE)).toBe(`${SCOPE}, ${SCOPE} *`);
  expect(scopeSelectorList("html > body .page-box", SCOPE)).toBe(
    `${SCOPE} .page-box`
  );
  expect(scopeSelectorList("body > p", SCOPE)).toBe(`${SCOPE} > p`);
  expect(scopeSelectorList("span", SCOPE)).toBe(`${SCOPE} span`);
  // A sibling of the body is never inside the scope.
  expect(scopeSelectorList("body + div", SCOPE)).toBeNull();
  expect(scopeSelectorList("body ~ div, p", SCOPE)).toBe(`${SCOPE} p`);
});

test("selectors that could reach outside the scope are dropped", () => {
  // Starting with a combinator: `[scope] ~ x` would be the scope's siblings.
  expect(scopeSelectorList("~ div", SCOPE)).toBeNull();
  expect(scopeSelectorList("+ div, p", SCOPE)).toBe(`${SCOPE} p`);
  expect(scopeSelectorList("> div", SCOPE)).toBeNull();
  // The nesting selector, outside a string only.
  expect(scopeSelectorList("& ~ *", SCOPE)).toBeNull();
  expect(scopeSelectorList('a[title="&"]', SCOPE)).toBe(
    `${SCOPE} a[title="&"]`
  );
  // Commas inside brackets and strings do not split the list.
  expect(scopeSelectorList('a:not([title="x, y"]) > b, i', SCOPE)).toBe(
    `${SCOPE} a:not([title="x, y"]) > b, ${SCOPE} i`
  );
  // A list that cannot be split with confidence is dropped whole.
  expect(scopeSelectorList('a[title="x, y], b', SCOPE)).toBeNull();
});

test("the output is written from the parsed rules: what the parser did not keep is gone", () => {
  // The declarations are the parser's serialisation (`style.cssText`).
  expect(
    scopeStylesheet(
      "p.docx-Normal { --docx-auto-line-spacing: 1.15; color: red; }",
      SCOPE,
      parseInJsdom
    )
  ).toBe(
    `${SCOPE} p.docx-Normal { --docx-auto-line-spacing: 1.15; color: red; }`
  );
  // A rule without declarations, an empty group, and anything unparsable
  // write nothing.
  expect(scopeStylesheet("p { } @media print { }", SCOPE, parseInJsdom)).toBe(
    ""
  );
  expect(scopeStylesheet("p { color: red }", SCOPE, () => null)).toBe("");
});

test("a style rule with nested rules is dropped", () => {
  const parseNested = (css: string) => {
    const rules = parseInJsdom(css);
    // jsdom does not parse nesting: give the rule a nested child, as a
    // browser parsing `p { color: blue; & ~ * { display: none } }` would.
    if (rules)
      Object.defineProperty(rules[0], "cssRules", { value: [rules[0]] });
    return rules;
  };
  expect(scopeStylesheet("p { color: blue }", SCOPE, parseNested)).toBe("");
});

test("isolateDocument takes the stylesheet out, prefixes ids and follows links to them", () => {
  const scope = createDocxScope();
  const { html, css } = isolateDocument(
    '<style>body { margin: 0 }</style><div id="pagination-staging" class="x-staging">' +
      '<p><a id="_Toc1"></a><a href="#_Toc1">see</a><a href="https://e.com/#a">out</a></p>' +
      '</div><div id="pagination-container" class="x-container"></div>',
    scope,
    parseInJsdom
  );
  expect(css).toBe(`${scope.selector} { margin: 0; }`);
  expect(html).toBe(
    '<div class="x-staging"><p>' +
      `<a id="${scope.idPrefix}_Toc1"></a><a href="#${scope.idPrefix}_Toc1">see</a>` +
      '<a href="https://e.com/#a">out</a></p></div><div class="x-container"></div>'
  );
});

test("every scope is its own, and its prefixes make valid class names", () => {
  const a = createDocxScope();
  const b = createDocxScope();
  expect(a.id).not.toBe(b.id);
  expect(a.selector).toBe(`[data-rca-docx="${a.id}"]`);
  for (const prefix of [a.idPrefix, a.documentPrefix, a.pagePrefix]) {
    expect(prefix).toMatch(/^rca-[0-9a-f-]+-(?:docx-|page-)?$/);
    expect(prefix).toContain(a.id);
  }
});
