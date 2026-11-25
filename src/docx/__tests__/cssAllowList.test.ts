import {
  ALLOWED_FUNCTIONS,
  ALLOWED_PROPERTIES,
  isAllowedDeclaration,
  isSafeSelectorList,
  isSafeValue,
} from "../cssAllowList";

const LINE_SPACING = "--docx-auto-line-spacing";
const X = "https://example.invalid/x";

describe("the property allow-list", () => {
  test.each([
    // What docxodus 12.4.1 writes, as Chromium enumerates it.
    ["text", "color font-family font-size font-style font-weight line-height"],
    ["text", "font-variant-caps letter-spacing text-align text-indent"],
    ["text", "text-decoration-line text-transform vertical-align"],
    ["text", "white-space-collapse text-wrap-mode overflow-wrap"],
    ["text", "text-size-adjust -webkit-text-size-adjust direction"],
    ["boxes", "display top left bottom right width height min-height"],
    ["boxes", "max-width margin-top margin-right margin-bottom margin-left"],
    ["boxes", "padding-top padding-left overflow-x overflow-y box-sizing"],
    ["boxes", "visibility opacity z-index float clear pointer-events zoom"],
    ["boxes", "transform transform-origin box-shadow"],
    ["borders", "border-top-width border-top-style border-top-color"],
    ["borders", "border-bottom-left-radius outline-color outline-offset"],
    ["backgrounds", "background-color background-clip background-origin"],
    ["backgrounds", "background-position-x background-size background-repeat"],
    ["tables", "table-layout border-collapse border-spacing"],
    ["tables", "-webkit-border-horizontal-spacing caption-side"],
    ["lists", "list-style-type list-style-position"],
    ["layout", "flex-direction flex-grow flex-shrink align-items"],
    ["layout", "justify-content row-gap column-gap column-count"],
    ["breaks", "break-before break-inside page-break-before orphans widows"],
    // Shorthands, for parsers that enumerate them.
    ["shorthands", "margin padding border background font gap overflow inset"],
    ["shorthands", "text-decoration white-space list-style flex columns"],
    // Logical equivalents.
    ["logical", "margin-inline-start padding-block-end inset-inline-end"],
    ["logical", "border-inline-start-color border-start-end-radius"],
    ["logical", "inline-size max-block-size overflow-inline"],
  ])("keeps %s properties: %s", (_group, list) => {
    for (const name of list.split(" ")) {
      expect([name, ALLOWED_PROPERTIES.has(name)]).toEqual([name, true]);
      expect([name, isAllowedDeclaration(name, "inherit")]).toEqual([
        name,
        true,
      ]);
    }
  });

  test.each([
    ["custom properties", "--x --annot-color --rca-page-scale --"],
    ["all", "all"],
    ["anchors", "anchor-name position-anchor anchor-scope position-area"],
    ["anchors", "position-try position-try-fallbacks position-visibility"],
    ["view transitions", "view-transition-name view-transition-class"],
    ["containers", "container container-name container-type contain"],
    ["generated content", "content quotes counter-increment counter-reset"],
    ["generated content", "counter-set"],
    ["cursor", "cursor"],
    ["images", "list-style-image border-image border-image-source"],
    ["images", "border-image-slice border-image-width border-image-outset"],
    ["images", "border-image-repeat -webkit-border-image"],
    ["images", "mask mask-image mask-border mask-border-source"],
    ["images", "-webkit-mask -webkit-mask-image -webkit-mask-box-image"],
    ["images", "-webkit-box-reflect shape-outside offset-path"],
    ["effects", "filter backdrop-filter clip-path -webkit-filter"],
    ["descriptors and legacy", "src behavior -moz-binding unicode-range"],
    ["timelines", "scroll-timeline scroll-timeline-name view-timeline"],
    ["timelines", "view-timeline-name animation-timeline timeline-scope"],
    ["animations", "animation animation-name animation-duration"],
    ["transitions", "transition transition-property transition-behavior"],
    ["paged media", "page size"],
    ["interaction", "user-select resize -webkit-user-modify appearance"],
    ["interaction", "-webkit-app-region will-change content-visibility"],
    ["unknown", "foo -x-bar color-"],
  ])("drops %s: %s", (_group, list) => {
    for (const name of list.split(" ")) {
      expect([name, ALLOWED_PROPERTIES.has(name)]).toEqual([name, false]);
      for (const value of ["inherit", "none", "1", "red"]) {
        expect([name, isAllowedDeclaration(name, value)]).toEqual([
          name,
          false,
        ]);
      }
    }
  });

  test("property names are compared without regard to ASCII case", () => {
    expect(isAllowedDeclaration("COLOR", "red")).toBe(true);
    expect(isAllowedDeclaration("Margin-Top", "1px")).toBe(true);
    // Not through a non-ASCII letter that lower-cases to an ASCII one
    // (U+212A, the Kelvin sign, lower-cases to "k").
    expect(isAllowedDeclaration("word-breaK", "normal")).toBe(false);
  });

  test("every allowed name is a plain lower-case property name", () => {
    for (const name of ALLOWED_PROPERTIES) {
      expect(name).toMatch(/^-?[a-z]+(?:-[a-z]+)*$/);
    }
  });
});

describe("the value grammar", () => {
  test.each([
    ["keywords", ["normal", "inherit", "pre-wrap", "break-word", "top left"]],
    ["numbers and lengths", ["0", "1.15", "11pt", "-9999px", "100%", ".001pt"]],
    ["lists and ratios", ["0 0 3pt 0", "solid windowtext 1.0pt", "1 / 2"]],
    ["colours", ["#525659", "white", "currentcolor", "rgb(82, 86, 89)"]],
    ["colours", ["rgba(0, 0, 0, 0.3) 0px 2px 8px", "rgb(1 2 3 / 50%)"]],
    ["colours", ["hsl(120, 50%, 50%)", "hsla(120 50% 50% / 0.5)"]],
    ["mathematics", ["calc(100% - 6px)", "calc((1px + 2px) * 3)"]],
    ["mathematics", ["min(1px, 2px)", "max(1em, 2px)", "clamp(1px, 2vw, 3px)"]],
    ["mathematics", ["calc(1px + min(2px, max(3px, clamp(1px, 2px, 3px))))"]],
    ["function names in any case", ["RGB(1, 2, 3)", "Calc(1px + 2px)"]],
    ["font families", ["Cambria, serif", '"Times New Roman", serif']],
    ["font families", ["'Arial', sans-serif", '"it\'s", serif']],
    ["font families", ["明朝, serif", '"ＭＳ 明朝"']],
    ["strings holding parentheses", ['"Font (Body)", serif']],
    ["conditions", ["print", "screen and (min-width: 100px)", "not all"]],
    ["conditions", ["(display: grid) and (not (display: inline-grid))"]],
  ])("accepts %s", (_class, values) => {
    for (const value of values) {
      expect([value, isSafeValue(value)]).toEqual([value, true]);
    }
  });

  test.each([
    ["the empty value", [""]],
    ["a backslash", ["u\\72l(x)", "\\75rl(x)", '"a\\"b"', "a\\,b", "red\\"]],
    ["@ { } ;", ["@import", "a{b", "a}b", "red; display: none", '"a;b"']],
    ["< >", ["</style>", '"<img>"', "a > b", "(width >= 600px)"]],
    ["! [ ]", ["red !important", "[a] 1fr", "a]"]],
    ["a comment", ["red /* x */", "/*", '"/*"']],
    ["a line break", ["a\nb", "a\rb", "a\fb", '"a\n"', "a b", "a b"]],
    ["a control character", ["a\tb", "a\u0000b", "a\u001fb", "a\u007fb"]],
    ["a control character", ["a\u0085b", "a\u009fb"]],
    ["unbalanced quotes", ['"abc', "'abc", "\"abc'", '\'a" "b']],
    ["unbalanced parentheses", ["calc(1px", "1px)", ")(", "rgb(1, 2, 3))"]],
    ["unbalanced parentheses", ['"a(b"', '"a)b"', "calc((1px)"]],
    ["a substitution function", ["var(--x)", "var(--x, red)", "VAR(--x)"]],
    ["a substitution function", ["env(safe-area-inset-top)", "env(x, 1px)"]],
    [
      "a substitution function",
      ["attr(data-x)", "if(else: red)", "inherit(--x)"],
    ],
    ["a substitution function", ["--custom(1)", "calc(1px * var(--x))"]],
    ["a substitution function", ["rgb(var(--r), 0, 0)", "min(1px, env(x))"]],
    ["a fetching function", [`url(${X})`, `URL(${X})`, `Url("${X}")`]],
    ["a fetching function", ["url(data:image/gif;base64,R0lGOD)"]],
    ["a fetching function", [`image("${X}")`, `image-set("${X}" 1x)`]],
    ["a fetching function", [`-webkit-image-set(url(${X}) 1x)`, `src("${X}")`]],
    ["a fetching function", [`cross-fade(url(${X}), red)`, "element(#a)"]],
    ["a fetching function", [`-webkit-cross-fade(url(${X}), url(${X}), 1)`]],
    ["a fetching function", [`red url(${X})`, `calc(1px) url(${X})`]],
    ["a function name inside a string", [`"url(${X})"`, '"var(--x)"']],
    ["any other function", ["linear-gradient(red, blue)", "paint(x)"]],
    ["any other function", ["color-mix(in srgb, red, blue)", "counter(x)"]],
    ["any other function", ["translate(1px, 2px)", "oklch(50% 0.2 30)"]],
    ["any other function", ["light-dark(red, blue)", "anchor(--a top)"]],
    ["any other function", ["ｕｒｌ(x)", "1(2)", "-(1px)"]],
    ["a name one letter off the list", ["rgbx(1, 2, 3)", "xcalc(1px)"]],
    ["a name one letter off the list", ["caſc(1px)", "Kalc(1px)"]],
  ])("rejects %s", (_class, values) => {
    for (const value of values) {
      expect([value, isSafeValue(value)]).toEqual([value, false]);
    }
  });

  test("the functions allowed are exactly these", () => {
    expect([...ALLOWED_FUNCTIONS].sort()).toEqual(
      ["calc", "clamp", "hsl", "hsla", "max", "min", "rgb", "rgba"].sort()
    );
  });

  test("a long value is checked in linear time", () => {
    const long = "a".repeat(1 << 20);
    const started = performance.now();
    expect(isSafeValue(`"${long}"`)).toBe(true);
    expect(isSafeValue(long)).toBe(true);
    expect(isSafeValue(`${long}(1px)`)).toBe(false);
    expect(isSafeValue(`calc(${"(".repeat(1 << 16)}1px`)).toBe(false);
    expect(performance.now() - started).toBeLessThan(2000);
  });
});

describe("properties kept with a narrower value", () => {
  test("position: static, relative or absolute only", () => {
    expect(ALLOWED_PROPERTIES.has("position")).toBe(true);
    for (const value of ["static", "relative", "absolute", "ABSOLUTE"]) {
      expect([value, isAllowedDeclaration("position", value)]).toEqual([
        value,
        true,
      ]);
    }
    for (const value of [
      "fixed",
      "FIXED",
      "sticky",
      "-webkit-sticky",
      "inherit",
      "unset",
      "var(--n, fixed)",
      "env(nope, sticky)",
      "\\66ixed",
      "absolute fixed",
    ]) {
      expect([value, isAllowedDeclaration("position", value)]).toEqual([
        value,
        false,
      ]);
    }
  });

  test("background-image: never an image", () => {
    expect(isAllowedDeclaration("background-image", "none")).toBe(true);
    expect(isAllowedDeclaration("background-image", "initial")).toBe(true);
    for (const value of [
      `url(${X})`,
      'url("data:image/gif;base64,R0lGOD")',
      "linear-gradient(red, blue)",
      `env(nope, u\\72l(${X}))`,
      "inherit",
      "none, none",
    ]) {
      expect([value, isAllowedDeclaration("background-image", value)]).toEqual([
        value,
        false,
      ]);
    }
    // Nor through the shorthand, for a parser that enumerates it.
    expect(isAllowedDeclaration("background", `red url(${X})`)).toBe(false);
    expect(isAllowedDeclaration("background", "red")).toBe(true);
  });

  test("the one custom property kept holds a plain number", () => {
    for (const value of ["1.15", "1", ".5", "2.", "-1"]) {
      expect([value, isAllowedDeclaration(LINE_SPACING, value)]).toEqual([
        value,
        true,
      ]);
    }
    for (const value of [
      "",
      "1e9",
      "1 2",
      "1px",
      "calc(1)",
      "var(--x)",
      '"1"',
      `url(${X})`,
      '")} body{display:none} q{"',
    ]) {
      expect([value, isAllowedDeclaration(LINE_SPACING, value)]).toEqual([
        value,
        false,
      ]);
    }
    // By exact name: custom property names are case-sensitive.
    expect(isAllowedDeclaration("--DOCX-AUTO-LINE-SPACING", "1")).toBe(false);
    expect(isAllowedDeclaration(`${LINE_SPACING}-2`, "1")).toBe(false);
  });

  test("the only var() kept is docxodus' line-height reading that property", () => {
    const reading = `calc(1lh * var(${LINE_SPACING}))`;
    expect(isAllowedDeclaration("line-height", reading)).toBe(true);
    for (const [name, value] of [
      ["line-height", `calc(1lh * var(${LINE_SPACING}, 2))`],
      ["line-height", `calc(1lh * var(${LINE_SPACING}, url(${X})))`],
      ["line-height", `calc(1lh * var(${LINE_SPACING})) `],
      ["line-height", `calc(1lh*var(${LINE_SPACING}))`],
      ["line-height", `var(${LINE_SPACING})`],
      ["line-height", "calc(1lh * var(--other))"],
      ["width", reading],
      ["font-size", reading],
    ]) {
      expect([name, value, isAllowedDeclaration(name, value)]).toEqual([
        name,
        value,
        false,
      ]);
    }
  });
});

describe("the selector grammar", () => {
  test("accepts what docxodus writes", () => {
    for (const list of [
      "body, body *",
      "p.rca-1-docx-Normal",
      "td, th",
      ".rca-1-page-box + .rca-1-page-box",
      ".rca-1-page-box:has(.rca-1-page-footer) .rca-1-page-number",
      '.rca-1-page-box[data-section-index="0"]',
      "html > body .page-box",
      ".footnote-content p:not(:first-of-type)",
    ]) {
      expect([list, isSafeSelectorList(list)]).toEqual([list, true]);
    }
  });

  test("rejects escapes, rule punctuation, comments, line breaks and unbalanced text", () => {
    for (const list of [
      "",
      "p.\\31 x",
      'a[title="\\"], body, [x=\\""]',
      'a[title="} body { display: none } x{"]',
      "p; q",
      "@media",
      "p /* x */",
      "a\nb",
      "a b",
      'a[title="x, y], b',
      "a:not(b",
      "a)",
      "a < b",
    ]) {
      expect([list, isSafeSelectorList(list)]).toEqual([list, false]);
    }
  });
});
