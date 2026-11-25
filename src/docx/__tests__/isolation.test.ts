import {
  createDocxScope,
  isolateDocument,
  scopeSelectorList,
  scopeStylesheet,
} from "../isolation";

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
  const { selectors, atRules } = parse(scopeStylesheet(DOCUMENT_CSS, SCOPE));

  expect(selectors.length).toBeGreaterThan(10);
  for (const selector of selectors) {
    // The scope element itself, or something inside it.
    expect(selector === SCOPE || selector.startsWith(`${SCOPE} `)).toBe(true);
    expect(selector).not.toMatch(/^\[data-rca-docx="s1"\] [+~]/);
  }
  // Only conditional groups survive; @page, @font-face, @keyframes and
  // @import act on the whole page.
  expect(atRules).toEqual(["@media print", "@supports (display: grid)"]);
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

test("strings, comments and escapes cannot end a rule early", () => {
  const scoped = scopeStylesheet(
    'p[title="a } b { c"] { color: red; } /* } body { */ .x\\{ { color: blue; }',
    SCOPE
  );
  // (Read as text: jsdom's CSS parser itself mis-reads the escaped brace.)
  expect(scoped).toBe(
    `${SCOPE} p[title="a } b { c"] { color: red; }\n` +
      `${SCOPE} .x\\{ { color: blue; }`
  );
});

test("declarations are kept as written", () => {
  expect(
    scopeStylesheet(
      "p.docx-Normal { --docx-auto-line-spacing: 1.15; line-height: calc(1lh * var(--docx-auto-line-spacing)); }",
      SCOPE
    )
  ).toBe(
    `${SCOPE} p.docx-Normal { --docx-auto-line-spacing: 1.15; line-height: calc(1lh * var(--docx-auto-line-spacing)); }`
  );
});

test("isolateDocument takes the stylesheet out, prefixes ids and follows links to them", () => {
  const scope = createDocxScope();
  const { html, css } = isolateDocument(
    '<style>body { margin: 0 }</style><div id="pagination-staging" class="x-staging">' +
      '<p><a id="_Toc1"></a><a href="#_Toc1">see</a><a href="https://e.com/#a">out</a></p>' +
      '</div><div id="pagination-container" class="x-container"></div>',
    scope
  );
  expect(css).toBe(`${scope.selector} { margin: 0 }`);
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
