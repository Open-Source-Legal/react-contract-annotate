import type { AnnotationLabel, Highlight } from "../../core/index";
import { buildDocxCss, cssString } from "../styles";
import type { DocxCssInput } from "../styles";

const CLAUSE: AnnotationLabel = {
  id: "label-1",
  text: "Important Clause",
  color: "#FF6B6B",
};

function css(input: Partial<DocxCssInput> = {}): string {
  return buildDocxCss({
    scope: "s1",
    labels: [CLAUSE],
    selectedIds: [],
    highlights: [],
    labelDisplay: "hover",
    ...input,
  });
}

/** The selectors of every rule whose body contains `needle`. */
function selectorsWith(sheet: string, needle: string): string[] {
  return sheet
    .split("}")
    .filter((rule) => rule.includes(needle))
    .map((rule) => rule.slice(0, rule.indexOf("{")).trim());
}

test("cssString escapes quotes, backslashes and control characters", () => {
  expect(cssString('a"b\\c')).toBe('"a\\"b\\\\c"');
  expect(cssString("line\nbreak")).toBe('"line\\a break"');
});

test("every rule is scoped to the instance's docx element", () => {
  const sheet = css({ selectedIds: ["d-1"] });
  const selectors = sheet
    .split("}")
    .filter((rule) => rule.includes("{"))
    .flatMap((rule) => rule.slice(0, rule.indexOf("{")).split(","))
    .map((selector) => selector.trim());
  expect(selectors.length).toBeGreaterThan(0);
  for (const selector of selectors) {
    expect(selector.startsWith('[data-rca-docx="s1"] ')).toBe(true);
  }
});

/** The selector text of each rule a browser parses out of `sheet`. */
function parsedRules(sheet: string): string[] {
  const style = document.createElement("style");
  style.textContent = sheet;
  document.head.append(style);
  try {
    return Array.from(style.sheet?.cssRules ?? []).map(
      (rule) => (rule as CSSStyleRule).selectorText
    );
  } finally {
    style.remove();
  }
}

test("host ids and label ids cannot break out of their selector", () => {
  const plain = parsedRules(css());
  const rules = parsedRules(
    css({
      labels: [{ id: 'x"] , body { color: red } [a="', text: "L" }],
      selectedIds: ['"]{}*{display:none}'],
    })
  );

  // The same rules as for a harmless id plus the selection's, each still
  // scoped to the instance: nothing in an id opened a rule of its own.
  expect(rules).toHaveLength(plain.length + 1);
  for (const selector of rules) {
    expect(selector.startsWith('[data-rca-docx="s1"] ')).toBe(true);
  }
});

test("unsafe colours fall back to the default grey and the highlight blue", () => {
  const highlight: Highlight = {
    id: "h-1",
    color: "red; } body { display: none",
    target: { kind: "span", start: 0, end: 4 },
  };
  const sheet = css({
    labels: [{ id: "l", text: "L", color: "#fff; } body {" }],
    highlights: [highlight],
  });
  expect(sheet).not.toContain("body {");
  expect(sheet).toContain("#616a6b");
  expect(sheet).toContain("--annot-color: #0EA5E9 !important;");
});

test("labels get chips unless labelDisplay is 'hide'", () => {
  expect(selectorsWith(css(), "content: attr(data-label)")).toHaveLength(1);
  expect(
    selectorsWith(css({ labelDisplay: "always" }), "content: attr(data-label)")
  ).toHaveLength(1);
  const hidden = css({ labelDisplay: "hide" });
  expect(hidden).not.toContain("::before");
  // The label's colour stays.
  expect(hidden).toContain("border-bottom: 2px solid #FF6B6B;");
});

test("a selected id outlines annotation elements only, not a highlight with that id", () => {
  const [selector] = selectorsWith(
    css({ selectedIds: ["same"] }),
    "outline: 2px solid #3b82f6"
  );
  expect(selector).toContain('[data-annotation-id="same"]');
  expect(selector).toContain(':not([data-label-id="__highlight__"])');
  expect(selector).toContain(':not([data-label-id="__highlight_active__"])');
  expect(selector).toContain(':not([data-label-id="__pending__"])');
});

test("each span highlight gets its own colour; other kinds are ignored", () => {
  const sheet = css({
    highlights: [
      {
        id: "h-1",
        color: "#16a34a",
        target: { kind: "span", start: 0, end: 4 },
      },
      {
        id: "h-t",
        color: "#dc2626",
        target: { kind: "tokens", tokensByPage: {} },
      },
    ],
  });
  expect(selectorsWith(sheet, "--annot-color: #16a34a")).toHaveLength(1);
  expect(sheet).not.toContain("#dc2626");
});
