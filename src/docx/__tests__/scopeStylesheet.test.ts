import { MAX_CSS_NESTING_OPENERS } from "../constants";
import {
  cleanInlineStyle,
  scopeSelectorList,
  scopeStylesheets,
} from "../scopeStylesheet";
import type { CssParser } from "../scopeStylesheet";
import { parseInJsdom } from "./jsdomCss";

// These check structure with jsdom's CSS parser (see `jsdomCss.ts`); the
// security regression tests run with Chromium's, in `ct-tests/docx.ct.tsx`.
// The allow-list itself is tested in `cssAllowList.test.ts`.

const SCOPE = '[data-rca-docx="s1"]';
const LINE_SPACING = "--docx-auto-line-spacing";
const X = "https://example.invalid/x";

/** One stylesheet scoped, parsed with jsdom's parser. */
function scoped(css: string): string {
  const result = scopeStylesheets([css], SCOPE, parseInJsdom);
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
  expect(scopeStylesheets(["p { color: red }"], SCOPE, () => null)).toEqual({
    css: "",
    rejected: false,
  });
});

test("only allow-listed declarations are written", () => {
  expect(
    scoped(
      "p { color: red; anchor-name: --menu; content: 'x'; cursor: pointer; " +
        "view-transition-name: hero; container-type: size; all: initial; " +
        "counter-increment: host; transition: color 1s; margin-top: 1px; }"
    )
  ).toBe(`${SCOPE} p { color: red; margin-top: 1px; }`);
  // A rule left without declarations is not written.
  expect(scoped("p { anchor-name: --menu } q { color: blue }")).toBe(
    `${SCOPE} q { color: blue; }`
  );
});

test("custom properties: only docxodus' line spacing, holding a number, is kept", () => {
  expect(
    scoped(
      `p { ${LINE_SPACING}: 1.15; --rca-x-page-scale: 1.00; --other: red; color: red; }`
    )
  ).toBe(`${SCOPE} p { ${LINE_SPACING}: 1.15; color: red; }`);
  expect(scoped(`p { ${LINE_SPACING}: ")} body{display:none} q{"; }`)).toBe("");
});

test("no var() is kept but docxodus' line-height reading its line spacing", () => {
  expect(
    scoped(`span { line-height: calc(1lh * var(${LINE_SPACING})); }`)
  ).toBe(`${SCOPE} span { line-height: calc(1lh * var(${LINE_SPACING})); }`);
  for (const declaration of [
    'color: var(--x, "a}b")',
    "color: var(--x, red)",
    `width: calc(1lh * var(${LINE_SPACING}))`,
    `line-height: calc(1lh * var(${LINE_SPACING}, 2))`,
    "margin-left: env(safe-area-inset-left)",
  ]) {
    expect([declaration, scoped(`span { ${declaration}; }`)]).toEqual([
      declaration,
      "",
    ]);
  }
});

test("nothing that could fetch is kept, data: URIs included", () => {
  expect(
    scoped(`p { background-image: url(${X}); color: red; } q { color: blue; }`)
  ).toBe(`${SCOPE} p { color: red; }\n${SCOPE} q { color: blue; }`);
  for (const declaration of [
    `background-image: url("${X}")`,
    'background-image: url("data:image/gif;base64,R0lGOD")',
    `background: red url(${X})`,
    `background: URL(${X})`,
    `list-style-image: url(${X})`,
    `list-style: url(${X}) inside`,
    `border-image: url(${X}) 1`,
    `cursor: url(${X}), auto`,
    `content: url(${X})`,
    `mask-image: url(${X})`,
    `background-image: image-set("${X}" 1x)`,
    `background-image: env(nope, u\\72l(${X}))`,
    `color: env(x) "; background-image: url(${X}); x: "`,
  ]) {
    expect([declaration, scoped(`p { ${declaration}; }`)]).toEqual([
      declaration,
      "",
    ]);
  }
});

test("position: fixed and sticky are not kept", () => {
  expect(
    scoped(
      "a { position: absolute } b { position: fixed } " +
        "i { position: sticky; top: 0 } u { position: relative }"
    )
  ).toBe(
    `${SCOPE} a { position: absolute; }\n${SCOPE} i { top: 0; }\n` +
      `${SCOPE} u { position: relative; }`
  );
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
  expect(scopeStylesheets(["p { color: blue }"], SCOPE, parseNested).css).toBe(
    ""
  );
});

test("grouping rules: the condition must pass the value grammar, and nesting is bounded", () => {
  expect(scoped("@media print { p { color: red } }")).toBe(
    `@media print {\n${SCOPE} p { color: red; }\n}`
  );
  expect(
    scoped("@media screen and (min-width: 100px) { p { color: red } }")
  ).toBe(
    `@media screen and (min-width: 100px) {\n${SCOPE} p { color: red; }\n}`
  );
  // A condition that is not plain text drops the group and what it holds.
  const unsafe: CssParser = (css) => {
    const rules = parseInJsdom(css);
    const media = (rules?.[0] as CSSMediaRule | undefined)?.media;
    if (media && !css.includes(SCOPE)) {
      Object.defineProperty(media, "mediaText", {
        value: `(min-width: env(x, url(${X})))`,
      });
    }
    return rules;
  };
  expect(
    scopeStylesheets(["@media print { p { color: red } }"], SCOPE, unsafe)
  ).toEqual({ css: "", rejected: false });

  const nested = (depth: number) =>
    "@media print {".repeat(depth) + " p { color: red } " + "}".repeat(depth);
  expect(scoped(nested(8))).toContain(`${SCOPE} p { color: red; }`);
  expect(scoped(nested(9))).toBe("");
});

test("several stylesheets are joined into the one that is validated", () => {
  const parsed: string[] = [];
  const recording: CssParser = (css) => {
    parsed.push(css);
    return parseInJsdom(css);
  };
  const result = scopeStylesheets(
    ["p { color: red }", "", "@media print { q { color: blue } }"],
    SCOPE,
    recording
  );
  expect(result).toEqual({
    css: `${SCOPE} p { color: red; }\n@media print {\n${SCOPE} q { color: blue; }\n}`,
    rejected: false,
  });
  // Each block parsed by itself, then the whole result, once, as inserted.
  expect(parsed).toEqual([
    "p { color: red }",
    "",
    "@media print { q { color: blue } }",
    result.css,
  ]);
  // Nothing kept, nothing to validate.
  expect(scopeStylesheets([], SCOPE, parseInJsdom)).toEqual({
    css: "",
    rejected: false,
  });
});

describe("CSS that could nest too deep is not parsed", () => {
  /** jsdom's parser, noting what it is given. */
  const recording = () => {
    const parsed: string[] = [];
    const parse: CssParser = (css) => {
      parsed.push(css);
      return parseInJsdom(css);
    };
    return { parsed, parse };
  };
  const RULE = "p { color: red } ";

  test("a block is kept with the most `{` allowed and dropped unparsed with one more", () => {
    expect(MAX_CSS_NESTING_OPENERS).toBe(4096);

    const atLimit = recording();
    const kept = scopeStylesheets(
      [RULE.repeat(MAX_CSS_NESTING_OPENERS)],
      SCOPE,
      atLimit.parse
    );
    expect(kept.rejected).toBe(false);
    expect(kept.css.split("\n")).toHaveLength(MAX_CSS_NESTING_OPENERS);
    // The block, then the stylesheet written.
    expect(atLimit.parsed).toHaveLength(2);

    const over = recording();
    expect(
      scopeStylesheets(
        [RULE.repeat(MAX_CSS_NESTING_OPENERS + 1)],
        SCOPE,
        over.parse
      )
    ).toEqual({ css: "", rejected: true });
    expect(over.parsed).toEqual([]);
  });

  test("it is a count: no `}` brings it down", () => {
    // Every rule above is closed, so those 4,097 never nest. Nor does any
    // number of closing braces, wherever they stand, make room for more.
    const closers = "}".repeat(MAX_CSS_NESTING_OPENERS);
    for (const block of [
      closers + RULE.repeat(MAX_CSS_NESTING_OPENERS + 1),
      RULE.repeat(MAX_CSS_NESTING_OPENERS) + closers + RULE,
      `/* ${"{}".repeat(MAX_CSS_NESTING_OPENERS + 1)} */ ${RULE}`,
    ]) {
      const { parsed, parse } = recording();
      expect(scopeStylesheets([block], SCOPE, parse)).toEqual({
        css: "",
        rejected: true,
      });
      expect(parsed).toEqual([]);
    }
    // And closing braces do not count against a block.
    expect(
      scopeStylesheets(
        [`/* ${"}".repeat(MAX_CSS_NESTING_OPENERS * 2)} */ ${RULE}`],
        SCOPE,
        parseInJsdom
      )
    ).toEqual({ css: `${SCOPE} p { color: red; }`, rejected: false });
  });

  test("`(` is bounded the same way, by itself", () => {
    const withParentheses = (count: number) =>
      `/* ${"(".repeat(count)} */ ${RULE}`;
    expect(
      scopeStylesheets(
        [withParentheses(MAX_CSS_NESTING_OPENERS)],
        SCOPE,
        parseInJsdom
      )
    ).toEqual({ css: `${SCOPE} p { color: red; }`, rejected: false });
    const { parsed, parse } = recording();
    expect(
      scopeStylesheets(
        [withParentheses(MAX_CSS_NESTING_OPENERS + 1)],
        SCOPE,
        parse
      )
    ).toEqual({ css: "", rejected: true });
    expect(parsed).toEqual([]);
    // The two are counted apart: the most of each is still kept.
    expect(
      scopeStylesheets(
        [
          `/* ${"(".repeat(MAX_CSS_NESTING_OPENERS)}` +
            `${"{".repeat(MAX_CSS_NESTING_OPENERS - 1)} */ ${RULE}`,
        ],
        SCOPE,
        parseInJsdom
      ).rejected
    ).toBe(false);
  });

  test("one block over the bound drops the whole stylesheet, and no block is parsed", () => {
    const { parsed, parse } = recording();
    expect(
      scopeStylesheets(
        [RULE, "@media all {".repeat(MAX_CSS_NESTING_OPENERS + 1), RULE],
        SCOPE,
        parse
      )
    ).toEqual({ css: "", rejected: true });
    expect(parsed).toEqual([]);
  });
});

describe("the validation: the stylesheet inserted must parse back to what was meant", () => {
  /** jsdom's parser, reading what is validated through `change`. */
  const reading =
    (change: (css: string) => string): CssParser =>
    (css) =>
      parseInJsdom(css.includes(SCOPE) ? change(css) : css);
  const SHEETS = ["p { color: blue } q { color: red }"];

  test("an extra rule, scoped or not, rejects the whole stylesheet", () => {
    for (const extra of [
      "body { display: none }",
      `${SCOPE} p { color: red }`,
      "@media print { p { color: red } }",
    ]) {
      expect(
        scopeStylesheets(
          SHEETS,
          SCOPE,
          reading((css) => `${css}\n${extra}`)
        )
      ).toEqual({ css: "", rejected: true });
    }
  });

  test("an extra rule between two stylesheets joined rejects it", () => {
    expect(
      scopeStylesheets(
        ["p { color: blue }", "q { color: red }"],
        SCOPE,
        reading((css) => css.replace("\n", "\nbody { display: none }\n"))
      )
    ).toEqual({ css: "", rejected: true });
  });

  test("a rule whose selector came back unscoped rejects it", () => {
    for (const change of [
      (css: string) => css.split(`${SCOPE} `).join(""),
      (css: string) => css.replace(`${SCOPE} p`, `${SCOPE} ~ p`),
      (css: string) => css.replace(`${SCOPE} p`, `${SCOPE} p, body`),
      (css: string) => css.replace(`${SCOPE} p`, `${SCOPE}.x p`),
    ]) {
      expect(scopeStylesheets(SHEETS, SCOPE, reading(change))).toEqual({
        css: "",
        rejected: true,
      });
    }
  });

  test("a rule that fails to parse back rejects it", () => {
    expect(
      scopeStylesheets(
        SHEETS,
        SCOPE,
        reading(() => "")
      )
    ).toEqual({ css: "", rejected: true });
  });

  test("a declaration off the allow-list that came back rejects it", () => {
    for (const smuggled of [
      `background-image: url(${X})`,
      "anchor-name: --menu",
      "position: fixed",
      "--x: 1",
      "color: var(--x)",
      'font-family: "a;b"',
    ]) {
      expect([
        smuggled,
        scopeStylesheets(
          SHEETS,
          SCOPE,
          reading((css) =>
            css.replace("color: blue;", `color: blue; ${smuggled};`)
          )
        ),
      ]).toEqual([smuggled, { css: "", rejected: true }]);
    }
    // An allowed declaration more is still the document's own styling.
    expect(
      scopeStylesheets(
        SHEETS,
        SCOPE,
        reading((css) => css.replace("color: blue;", "color: blue; margin: 0;"))
      ).rejected
    ).toBe(false);
  });

  test("a grouping rule that came back with another condition or kind rejects it", () => {
    const sheets = ["@media print { p { color: blue } }"];
    expect(scopeStylesheets(sheets, SCOPE, parseInJsdom).rejected).toBe(false);
    const unsafeCondition: CssParser = (css) => {
      const rules = parseInJsdom(css);
      if (rules && css.includes(SCOPE)) {
        Object.defineProperty((rules[0] as CSSMediaRule).media, "mediaText", {
          value: `(min-width: env(x, url(${X})))`,
        });
      }
      return rules;
    };
    expect(scopeStylesheets(sheets, SCOPE, unsafeCondition)).toEqual({
      css: "",
      rejected: true,
    });
    expect(
      scopeStylesheets(
        sheets,
        SCOPE,
        reading((css) => css.replace("@media print", "@supports (a: b)"))
      )
    ).toEqual({ css: "", rejected: true });
  });
});

describe("cleanInlineStyle", () => {
  const cleaned = (style: string): string | null => {
    const element = document.createElement("span");
    element.setAttribute("style", style);
    cleanInlineStyle(element);
    return element.getAttribute("style");
  };

  test("keeps only allow-listed declarations", () => {
    expect(
      cleaned(
        `color: red; background-image: url(${X}); position: fixed; --x: 1; ` +
          "anchor-name: --menu; font-weight: bold"
      )
    ).toBe("color: red; font-weight: bold;");
    expect(cleaned("width: 144pt;")).toBe("width: 144pt;");
    expect(cleaned("position: absolute; top: 1px")).toBe(
      "position: absolute; top: 1px;"
    );
  });

  test("removes the attribute when nothing is left", () => {
    for (const style of [
      "position: sticky",
      "position: fixed",
      `background: url(${X})`,
      "--x: 1",
      "",
      "nonsense",
    ]) {
      expect([style, cleaned(style)]).toEqual([style, null]);
    }
  });

  test("removes the attribute when what was written does not validate", () => {
    const element = document.createElement("span");
    element.setAttribute("style", "color: red");
    // A parser whose second reading holds a declaration more.
    const { setAttribute } = element;
    element.setAttribute = (name: string, value: string) =>
      setAttribute.call(element, name, `${value} cursor: pointer;`);
    cleanInlineStyle(element);
    expect(element.hasAttribute("style")).toBe(false);
  });

  test("removes the attribute of an element without a style object", () => {
    const element = document.createElementNS("urn:x", "thing");
    element.setAttribute("style", "color: red");
    cleanInlineStyle(element);
    expect(element.hasAttribute("style")).toBe(false);
  });
});
