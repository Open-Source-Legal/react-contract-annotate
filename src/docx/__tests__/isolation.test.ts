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

test("isolateDocument cleans inline styles", () => {
  const scope = createDocxScope();
  const { html } = isolateDocument(
    '<p style="color: red; background: url(https://example.invalid/x)">a</p>' +
      '<p style="position: fixed">b</p>',
    scope,
    parseInJsdom
  );
  expect(html).toBe('<p style="color: red;">a</p><p>b</p>');
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
