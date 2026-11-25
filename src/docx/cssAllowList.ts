/**
 * What a converted document's CSS may say (spec "Isolation"): an allow-list
 * of properties and a conservative grammar for values. Pure text checks,
 * applied to what the browser's parser returns (`scopeStylesheet.ts` applies
 * them to the document's rules and inline styles, and again to the
 * stylesheet it wrote).
 *
 * Properties. Only the presentational properties listed here are kept. The
 * list is what docxodus 12.4.1 writes (its stylesheets for the fixtures and
 * for a document exercising run, paragraph, table, list, tab, section and
 * image formatting, and the declarations in its assembly's strings), under
 * the names Chromium enumerates a declaration block by (longhands: `margin`
 * is `margin-top` …, `white-space` is `white-space-collapse` and
 * `text-wrap-mode`, `border-spacing` is the two `-webkit-border-*-spacing`),
 * with the shorthands for parsers that enumerate those, plus the usual
 * typographic and box properties and their logical equivalents.
 *
 * Everything else is dropped. In particular: custom properties (but one, see
 * below) and `all`; what names something for the whole page (`anchor-name`,
 * `position-anchor`, `anchor-scope`, `view-transition-name`,
 * `container-name`, `container-type`, `counter-*`, `page`, timelines,
 * animations and transitions); and what shows or fetches other content
 * (`content`, `cursor`, `mask*`, `filter`, `backdrop-filter`, `clip-path`,
 * `shape-outside`, `list-style-image`, `border-image*`, `src`, `behavior`,
 * `-moz-binding`). Five properties are kept with a narrower value:
 * - `position`: `static`, `relative` or `absolute` only;
 * - `background-image`: `none` or `initial` only, which is what a
 *   `background` shorthand without an image expands to; never an image;
 * - `visibility`: `hidden`, `collapse` or `inherit` only, and
 *   `pointer-events`: `none` only, which is what docxodus writes: a document
 *   can hide its content or let the pointer through it, never make itself
 *   visible or clickable inside a viewer the host hid or made inert;
 * - `--docx-auto-line-spacing`, the one custom property kept: a plain
 *   number. docxodus declares it on paragraphs and reads it in exactly one
 *   declaration, `line-height: calc(1lh * var(--docx-auto-line-spacing))`,
 *   which is kept when its value is that text exactly. That is the only
 *   `var()` that survives, and all it can substitute is that number.
 *
 * Values. A value (and the condition of a grouping rule) must be plain: no
 * backslash, none of `@ { } ; < > ! [ ]`, no `/*`, no control character or
 * line break, quotes and parentheses balanced, and every function (an
 * identifier followed by `(`, wherever it stands) one of `rgb`, `rgba`,
 * `hsl`, `hsla`, `calc`, `min`, `max`, `clamp`, compared without regard to
 * ASCII case. So no substitution function (`var`, `env`, `attr`, `if`, …)
 * and no fetching function (`url`, `image`, `image-set`, `src`,
 * `cross-fade`, `element`, …) appears in any spelling: an escaped name has a
 * backslash, and any other name is not on the list.
 */

/** The custom property docxodus' paragraph rules declare (a number). */
const LINE_SPACING_PROPERTY = "--docx-auto-line-spacing";
/** The one declaration value that reads it, as docxodus 12.4.1 writes it. */
const LINE_SPACING_LINE_HEIGHT = `calc(1lh * var(${LINE_SPACING_PROPERTY}))`;
/** The value a kept custom property must have. */
const NUMBER = /^-?(?:\d+\.?\d*|\.\d+)$/;

const names = (list: string): string[] => list.trim().split(/\s+/);

/** The properties a document's rules and inline styles may set. */
export const ALLOWED_PROPERTIES: ReadonlySet<string> = new Set([
  // Text
  ...names(`
    color
    font font-family font-size font-style font-weight font-stretch font-width
    font-variant font-variant-caps font-variant-ligatures font-variant-numeric
    font-variant-east-asian font-variant-alternates font-variant-position
    font-variant-emoji font-kerning font-optical-sizing font-feature-settings
    font-variation-settings font-size-adjust font-language-override
    font-synthesis font-synthesis-weight font-synthesis-style
    font-synthesis-small-caps
    line-height letter-spacing word-spacing
    text-align text-align-last text-indent text-justify text-transform
    text-decoration text-decoration-line text-decoration-style
    text-decoration-color text-decoration-thickness text-decoration-skip-ink
    text-underline-offset text-underline-position
    text-shadow text-emphasis text-emphasis-style text-emphasis-color
    text-emphasis-position text-overflow text-orientation
    text-combine-upright text-size-adjust -webkit-text-size-adjust
    white-space white-space-collapse text-wrap text-wrap-mode text-wrap-style
    vertical-align tab-size hyphens overflow-wrap word-wrap word-break
    line-break direction unicode-bidi writing-mode
  `),
  // Boxes
  ...names(`
    display box-sizing float clear position z-index opacity visibility
    top right bottom left inset inset-block inset-block-start inset-block-end
    inset-inline inset-inline-start inset-inline-end
    width height min-width min-height max-width max-height
    block-size inline-size min-block-size min-inline-size max-block-size
    max-inline-size
    margin margin-top margin-right margin-bottom margin-left
    margin-block margin-block-start margin-block-end
    margin-inline margin-inline-start margin-inline-end
    padding padding-top padding-right padding-bottom padding-left
    padding-block padding-block-start padding-block-end
    padding-inline padding-inline-start padding-inline-end
    overflow overflow-x overflow-y overflow-block overflow-inline
    transform transform-origin zoom pointer-events
  `),
  // Borders, outlines and backgrounds (no image of any kind)
  ...names(`
    border border-width border-style border-color
    border-top border-top-width border-top-style border-top-color
    border-right border-right-width border-right-style border-right-color
    border-bottom border-bottom-width border-bottom-style border-bottom-color
    border-left border-left-width border-left-style border-left-color
    border-block border-block-width border-block-style border-block-color
    border-block-start border-block-start-width border-block-start-style
    border-block-start-color
    border-block-end border-block-end-width border-block-end-style
    border-block-end-color
    border-inline border-inline-width border-inline-style border-inline-color
    border-inline-start border-inline-start-width border-inline-start-style
    border-inline-start-color
    border-inline-end border-inline-end-width border-inline-end-style
    border-inline-end-color
    border-radius border-top-left-radius border-top-right-radius
    border-bottom-right-radius border-bottom-left-radius
    border-start-start-radius border-start-end-radius border-end-start-radius
    border-end-end-radius
    outline outline-color outline-style outline-width outline-offset
    box-shadow
    background background-color background-image background-attachment
    background-clip background-origin background-position
    background-position-x background-position-y background-repeat
    background-size
  `),
  // Tables and lists
  ...names(`
    table-layout border-collapse border-spacing
    -webkit-border-horizontal-spacing -webkit-border-vertical-spacing
    caption-side empty-cells
    list-style list-style-type list-style-position
  `),
  // Flex layout, columns and page breaks (docxodus' pagination CSS)
  ...names(`
    flex flex-basis flex-direction flex-flow flex-grow flex-shrink flex-wrap
    order align-content align-items align-self justify-content justify-items
    justify-self place-content place-items place-self gap row-gap column-gap
    columns column-count column-width column-height column-wrap column-fill
    column-span column-rule column-rule-color column-rule-style
    column-rule-width
    break-before break-after break-inside page-break-before page-break-after
    page-break-inside orphans widows
  `),
]);

/** The properties kept with only these values (see the module comment). */
const NARROWED_VALUES: ReadonlyMap<string, RegExp> = new Map([
  ["position", /^(?:static|relative|absolute)$/],
  ["background-image", /^(?:none|initial)$/],
  ["visibility", /^(?:hidden|collapse|inherit)$/],
  ["pointer-events", /^none$/],
]);

/** The functions a value may call. */
export const ALLOWED_FUNCTIONS: ReadonlySet<string> = new Set([
  "rgb",
  "rgba",
  "hsl",
  "hsla",
  "calc",
  "min",
  "max",
  "clamp",
]);

/** `text` with its ASCII letters in lower case (CSS compares names so). */
function asciiLowerCase(text: string): string {
  return text.replace(/[A-Z]/g, (letter) => letter.toLowerCase());
}

/**
 * Characters no kept value has: an escape, what opens or ends a rule, a
 * declaration, a priority, a comment or a markup tag, a bracket block, a
 * control character or a line break.
 */
const UNSAFE_IN_VALUE =
  /[\\@{};<>![\]\u0000-\u001f\u007f-\u009f\u2028\u2029]|\/\*/;

/** A character of an identifier (escapes aside, which no kept text has). */
const IDENTIFIER_CHARACTER = /[-\w\u0080-\uffff]/;

/**
 * Whether `text` is plain: without unsafe characters, its quotes balanced
 * and its parentheses balanced (counted inside strings too, so the text is
 * balanced however it is read).
 */
function isPlain(text: string, unsafe: RegExp): boolean {
  if (text === "" || unsafe.test(text)) return false;
  let quote: string | null = null;
  let depth = 0;
  for (const char of text) {
    if (char === '"' || char === "'") {
      if (quote === null) quote = char;
      else if (quote === char) quote = null;
    } else if (char === "(") {
      depth++;
    } else if (char === ")" && --depth < 0) {
      return false;
    }
  }
  return quote === null && depth === 0;
}

/** The identifier that ends just before `index` (empty when none does). */
function identifierBefore(text: string, index: number): string {
  let start = index;
  while (start > 0 && IDENTIFIER_CHARACTER.test(text[start - 1])) start--;
  return text.slice(start, index);
}

/**
 * Whether a parsed value (or the condition of a grouping rule) passes the
 * value grammar of the module comment.
 */
export function isSafeValue(value: string): boolean {
  if (!isPlain(value, UNSAFE_IN_VALUE)) return false;
  for (
    let open = value.indexOf("(");
    open !== -1;
    open = value.indexOf("(", open + 1)
  ) {
    // A parenthesis after no identifier only groups, as inside `calc()`.
    const name = identifierBefore(value, open);
    if (name !== "" && !ALLOWED_FUNCTIONS.has(asciiLowerCase(name))) {
      return false;
    }
  }
  return true;
}

/**
 * Characters no kept selector has: an escape, what opens or ends a rule, a
 * declaration, a priority, a comment or a markup tag, a control character
 * or a line break. (Brackets, quotes and `>` are part of selectors.)
 */
const UNSAFE_IN_SELECTOR =
  /[\\@{};<!\u0000-\u001f\u007f-\u009f\u2028\u2029]|\/\*/;

/**
 * Whether a parsed selector list is plain enough to be split and read as
 * text: with no escape in it, a string ends at its next quote, so the
 * scanners of `scopeStylesheet.ts` read it as a CSS parser does.
 */
export function isSafeSelectorList(list: string): boolean {
  return isPlain(list, UNSAFE_IN_SELECTOR);
}

/**
 * Whether the declaration `name: value`, as the parser returns them, may be
 * kept: an allowed property with a value passing the grammar (and the
 * property's narrower values, when it has them).
 */
export function isAllowedDeclaration(name: string, value: string): boolean {
  // Custom property names are case-sensitive.
  if (name === LINE_SPACING_PROPERTY) return NUMBER.test(value);
  const property = asciiLowerCase(name);
  if (!ALLOWED_PROPERTIES.has(property)) return false;
  if (property === "line-height" && value === LINE_SPACING_LINE_HEIGHT) {
    return true;
  }
  const narrowed = NARROWED_VALUES.get(property);
  if (narrowed && !narrowed.test(asciiLowerCase(value))) return false;
  return isSafeValue(value);
}
