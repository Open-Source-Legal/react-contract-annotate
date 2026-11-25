/**
 * What a converted document's HTML may contain (spec "Isolation"): an
 * allow-list of elements and attributes, which DOMPurify applies as its
 * per-call configuration (`loader.ts`). CSS has its own allow-list
 * (`cssAllowList.ts`).
 *
 * The lists are what docxodus 12.4.1 writes: in converted documents (the
 * fixtures between them have paragraphs, headings, runs, sub- and
 * superscript, tabs, line and page breaks, list markers, tables with merged
 * cells and column widths, an image and links to URLs and to a bookmark)
 * and in projected HTML (spans). Its document-level elements (`html`,
 * `head`, `meta`, `title`) are not content and go. Its `data-*` attributes
 * (which the pagination reads and projection writes) are kept by DOMPurify
 * whatever the lists say (`ALLOW_DATA_ATTR`, its default), and so are
 * `aria-*` attributes; `style` elements are kept by the loader's config
 * alone, to be taken out by `isolateDocument`.
 *
 * Everything else is dropped, so a document cannot make the browser fetch a
 * URL of its choosing through its HTML either: no SVG or MathML, no media,
 * forms, embedded content, image maps, dialogs or popovers, and of the
 * attributes that name a URL only `href` (on links, whose clicks `DocxView`
 * intercepts) and `src` (on images, which `isolateDocument` drops unless it
 * is a `data:` URL of an image). `target` and `rel` are kept so that
 * projected HTML, sanitised again, keeps what `isolateDocument` set on links.
 */

export const ALLOWED_TAGS: readonly string[] = Object.freeze([
  "a",
  "br",
  "col",
  "colgroup",
  "div",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "img",
  "p",
  "span",
  "sub",
  "sup",
  "table",
  "tbody",
  "td",
  "tr",
]);

export const ALLOWED_ATTRIBUTES: readonly string[] = Object.freeze([
  "align",
  "alt",
  "class",
  "colspan",
  "dir",
  "href",
  "id",
  "rel",
  "rowspan",
  "src",
  "style",
  "target",
  "xml:space",
  "xmlns",
]);
