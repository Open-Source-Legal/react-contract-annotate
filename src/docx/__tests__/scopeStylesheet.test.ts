import {
  cleanInlineStyle,
  fetchesExternally,
  scopeSelectorList,
  scopeStylesheet,
} from "../scopeStylesheet";
import type { CssParser } from "../scopeStylesheet";
import { parseInJsdom } from "./jsdomCss";

// These check structure with jsdom's CSS parser (see `jsdomCss.ts`); the
// security regression tests run with Chromium's, in `ct-tests/docx.ct.tsx`.

const SCOPE = '[data-rca-docx="s1"]';
const LINE_SPACING = "--docx-auto-line-spacing";

/** The scoped stylesheet, parsed with jsdom's parser. */
function scoped(
  css: string,
  customProperties: ReadonlySet<string> = new Set([LINE_SPACING])
): string {
  const result = scopeStylesheet(css, SCOPE, {
    customProperties,
    parse: parseInJsdom,
  });
  expect(result.rejected).toBe(false);
  return result.css;
}

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
  const { selectors, atRules } = parse(scoped(DOCUMENT_CSS));

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

test("the output is written from the parsed rules, one declaration at a time", () => {
  expect(
    scoped("p.docx-Normal { color: red !important; margin-left: 2px; }")
  ).toBe(`${SCOPE} p.docx-Normal { color: red !important; margin-left: 2px; }`);
  // A rule without declarations, an empty group, and anything unparsable
  // write nothing.
  expect(scoped("p { } @media print { }")).toBe("");
  expect(
    scopeStylesheet("p { color: red }", SCOPE, { parse: () => null })
  ).toEqual({
    css: "",
    rejected: false,
  });
});

test("custom properties: only the named ones, holding a number, are kept", () => {
  expect(
    scoped(
      `p { ${LINE_SPACING}: 1.15; --rca-x-page-scale: 1.00; --other: red; color: red; }`
    )
  ).toBe(`${SCOPE} p { ${LINE_SPACING}: 1.15; color: red; }`);
  expect(scoped(`p { ${LINE_SPACING}: ")} body{display:none} q{"; }`)).toBe("");
  expect(scoped(`p { ${LINE_SPACING}: 1.15; }`, new Set())).toBe("");
});

test("a value still holding var() is kept only when made of plain characters", () => {
  expect(
    scoped(`span { line-height: calc(1lh * var(${LINE_SPACING})); }`)
  ).toBe(`${SCOPE} span { line-height: calc(1lh * var(${LINE_SPACING})); }`);
  expect(scoped('span { color: var(--x, "a}b"); }')).toBe("");
});

test("nothing that fetches is kept, except data: URIs", () => {
  expect(
    scoped(
      "p { background-image: url(https://example.invalid/x); color: red; } " +
        'q { background-image: url("data:image/gif;base64,R0lGOD"); }'
    )
  ).toBe(
    `${SCOPE} p { color: red; }\n` +
      `${SCOPE} q { background-image: url("data:image/gif;base64,R0lGOD"); }`
  );
  for (const value of [
    'url("https://example.invalid/x")',
    "url(x.png)",
    "URL(x.png)",
    "linear-gradient(red, blue), url(x)",
    'image-set("x.png" 1x)',
    '-webkit-image-set(url("data:a") 1x)',
    'cross-fade(url("data:a"), url("data:b"), 50%)',
    "element(#x)",
    'src("x")',
  ]) {
    expect(fetchesExternally(value)).toBe(true);
  }
  for (const value of [
    'url("data:image/png;base64,AAAA")',
    "url(data:x)",
    "linear-gradient(red, blue)",
    'counter-url("x")',
  ]) {
    expect(fetchesExternally(value)).toBe(false);
  }
});

test("a style rule with nested rules is dropped", () => {
  const parseNested: CssParser = (css) => {
    const rules = parseInJsdom(css);
    // jsdom does not parse nesting: give the rule a nested child, as a
    // browser parsing `p { color: blue; & ~ * { display: none } }` would.
    if (rules)
      Object.defineProperty(rules[0], "cssRules", { value: [rules[0]] });
    return rules;
  };
  expect(
    scopeStylesheet("p { color: blue }", SCOPE, { parse: parseNested }).css
  ).toBe("");
});

describe("the check: the stylesheet built must parse back to what was meant", () => {
  /** jsdom's parser, with `extra` parsed in after what it checks. */
  const tampering =
    (extra: string): CssParser =>
    (css) =>
      css.includes(SCOPE)
        ? parseInJsdom(`${css}\n${extra}`)
        : parseInJsdom(css);

  test("an extra rule, scoped or not, rejects the whole stylesheet", () => {
    for (const extra of [
      "body { display: none }",
      `${SCOPE} p { color: red }`,
      "@media print { p { color: red } }",
    ]) {
      expect(
        scopeStylesheet("p { color: blue } q { color: red }", SCOPE, {
          parse: tampering(extra),
        })
      ).toEqual({ css: "", rejected: true });
    }
  });

  test("a rule whose selector came back unscoped rejects it", () => {
    const unscoping: CssParser = (css) =>
      parseInJsdom(css.includes(SCOPE) ? css.split(`${SCOPE} `).join("") : css);
    expect(
      scopeStylesheet("p { color: blue }", SCOPE, { parse: unscoping })
    ).toEqual({ css: "", rejected: true });
  });

  test("a rule that fails to parse back rejects it", () => {
    const losing: CssParser = (css) =>
      css.includes(SCOPE) ? parseInJsdom("") : parseInJsdom(css);
    expect(
      scopeStylesheet("p { color: blue }", SCOPE, { parse: losing })
    ).toEqual({ css: "", rejected: true });
  });
});

test("cleanInlineStyle keeps only declarations that neither fetch nor fix", () => {
  const element = document.createElement("span");
  element.setAttribute(
    "style",
    "color: red; background-image: url(https://example.invalid/x); " +
      "position: fixed; --x: 1; font-weight: bold"
  );
  cleanInlineStyle(element, new Set());
  expect(element.getAttribute("style")).toBe("color: red; font-weight: bold;");

  const fixedOnly = document.createElement("span");
  fixedOnly.setAttribute("style", "position: sticky");
  cleanInlineStyle(fixedOnly, new Set());
  expect(fixedOnly.hasAttribute("style")).toBe(false);
});
