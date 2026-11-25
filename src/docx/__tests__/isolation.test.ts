import { createDocxScope, isolateDocument } from "../isolation";
import { parseInJsdom } from "./jsdomCss";

test("isolateDocument takes the stylesheet out, prefixes ids and follows links to them", () => {
  const scope = createDocxScope();
  const { html, css, cssRejected } = isolateDocument(
    '<style>body { margin: 0 }</style><div id="pagination-staging" class="x-staging">' +
      '<p><a id="_Toc1"></a><a href="#_Toc1">see</a><a href="https://e.com/#a">out</a></p>' +
      '</div><div id="pagination-container" class="x-container"></div>',
    scope,
    parseInJsdom
  );
  expect(css).toBe(`${scope.selector} { margin: 0; }`);
  expect(cssRejected).toBe(false);
  const link = 'target="_blank" rel="noopener noreferrer"';
  expect(html).toBe(
    '<div class="x-staging"><p>' +
      `<a id="${scope.idPrefix}_Toc1"></a><a href="#${scope.idPrefix}_Toc1" ${link}>see</a>` +
      `<a href="https://e.com/#a" ${link}>out</a></p></div><div class="x-container"></div>`
  );
});

test("isolateDocument opens every link in a new tab with no opener or referrer, whatever the document said", () => {
  const scope = createDocxScope();
  const { html } = isolateDocument(
    '<a href="https://e.com/" target="_top" rel="opener">a</a>' +
      '<a href="page.html" target="_self">b</a><a id="c">c</a>',
    scope,
    parseInJsdom
  );
  expect(html).toBe(
    '<a href="https://e.com/" target="_blank" rel="noopener noreferrer">a</a>' +
      '<a href="page.html" target="_blank" rel="noopener noreferrer">b</a>' +
      `<a id="${scope.idPrefix}c">c</a>`
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

test("isolateDocument cleans inline styles", () => {
  const scope = createDocxScope();
  const { html } = isolateDocument(
    '<p style="color: red; background: url(https://example.invalid/x)">a</p>' +
      '<p style="position: fixed">b</p>' +
      '<p style="anchor-name: --menu; width: 144pt">c</p>' +
      '<svg><rect style="fill: url(https://example.invalid/y)"></rect></svg>',
    scope,
    parseInJsdom
  );
  expect(html).toBe(
    '<p style="color: red;">a</p><p>b</p><p style="width: 144pt;">c</p>' +
      "<svg><rect></rect></svg>"
  );
});

test("isolateDocument returns all the style blocks as the one stylesheet validated", () => {
  const scope = createDocxScope();
  const parsed: string[] = [];
  const { html, css, cssRejected } = isolateDocument(
    "<style>p { color: red }</style><p>a</p>" +
      "<svg><style>q { color: blue }</style></svg>" +
      "<style>i { cursor: pointer }</style>",
    scope,
    (text) => {
      parsed.push(text);
      return parseInJsdom(text);
    }
  );
  expect(css).toBe(
    `${scope.selector} p { color: red; }\n${scope.selector} q { color: blue; }`
  );
  expect(cssRejected).toBe(false);
  expect(html).toBe("<p>a</p><svg></svg>");
  // The blocks, each by itself, then the stylesheet returned, whole.
  expect(parsed).toEqual([
    "p { color: red }",
    "q { color: blue }",
    "i { cursor: pointer }",
    css,
  ]);
});

test("isolateDocument reports a stylesheet that failed the check, and keeps none of it", () => {
  const scope = createDocxScope();
  const tampering = (css: string) =>
    parseInJsdom(
      css.includes(scope.selector) ? `${css} body { margin: 0 }` : css
    );
  const { css, cssRejected } = isolateDocument(
    "<style>p { color: red }</style><p>a</p>",
    scope,
    tampering
  );
  expect(css).toBe("");
  expect(cssRejected).toBe(true);
});

test("isolateDocument keeps a source only when the URL parser reads a data: URL of an image", () => {
  const scope = createDocxScope();
  const template = document.createElement("template");
  template.innerHTML = isolateDocument(
    '<img src="data:image/png;base64,AA=="><img src="DATA:Image/GIF;base64,AA==">' +
      '<img src=" data:image/png;base64,AA=="><img src="https://example.invalid/a">' +
      '<img src="/b.png"><img src="data:text/plain,image/"><span src="https://example.invalid/c"></span>',
    scope,
    parseInJsdom
  ).html;
  expect(
    Array.from(template.content.querySelectorAll("img, span"), (element) =>
      element.getAttribute("src")
    )
  ).toEqual([
    "data:image/png;base64,AA==",
    "DATA:Image/GIF;base64,AA==",
    " data:image/png;base64,AA==",
    null,
    null,
    null,
    null,
  ]);
});
