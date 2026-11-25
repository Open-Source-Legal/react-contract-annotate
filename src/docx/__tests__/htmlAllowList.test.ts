import { ALLOWED_ATTRIBUTES, ALLOWED_TAGS } from "../htmlAllowList";
import { createDocxScope, isolateDocument } from "../isolation";
import { sanitizeDocxHtml, sanitizeProjectedHtml } from "../loader";
import { parseInJsdom } from "./jsdomCss";

vi.mock("docxodus", async () =>
  (await import("./docxodusFake")).docxodusModule()
);

const X = "https://example.invalid";
const DATA_IMAGE = "data:image/png;base64,iVBORw0KGgo=";

/** What the DOCX format makes of converted HTML: sanitised, then isolated. */
function isolated(html: string): DocumentFragment {
  const template = document.createElement("template");
  template.innerHTML = isolateDocument(
    sanitizeDocxHtml(html),
    createDocxScope(),
    parseInJsdom
  ).html;
  return template.content;
}

/** Every element of `fragment`, as `tag[attribute …]`. */
function inventory(fragment: DocumentFragment): string[] {
  return Array.from(
    fragment.querySelectorAll("*"),
    (element) =>
      `${element.tagName.toLowerCase()}[${element
        .getAttributeNames()
        .join(" ")}]`
  );
}

test("what docxodus writes is kept: its elements, attributes and data attributes", () => {
  const fragment = isolated(
    '<div id="pagination-staging" class="s"><div data-section-index="0" data-page-width="612.0">' +
      '<h1 dir="ltr" class="h" data-keep-with-next="true">T</h1>' +
      '<p dir="ltr" class="p" data-source-anchor-id="p:1"><span xml:space="preserve" class="r">a</span>' +
      '<span data-docx-tab="left" data-docx-tab-width="0.5"></span><sup>1</sup><sub>2</sub><br>' +
      `<a href="${X}/link" class="l"><span>link</span></a><a id="b"></a>` +
      `<img src="${DATA_IMAGE}" style="width: 1in" alt="dot" xmlns=""></p>` +
      '<div align="left"><table dir="ltr" class="t"><colgroup><col style="width: 10pt"></colgroup>' +
      '<tbody><tr><td colspan="2" rowspan="1" class="c">x</td></tr></tbody></table></div>' +
      '<div class="pb" data-page-break="true"></div>' +
      '</div></div><div id="pagination-container" class="c"></div>'
  );
  expect(inventory(fragment)).toEqual([
    "div[class]",
    "div[data-section-index data-page-width]",
    "h1[dir class data-keep-with-next]",
    "p[dir class data-source-anchor-id]",
    "span[xml:space class]",
    "span[data-docx-tab data-docx-tab-width]",
    "sup[]",
    "sub[]",
    "br[]",
    "a[href class target rel]",
    "span[]",
    "a[id]",
    "img[src style alt xmlns]",
    "div[align]",
    "table[dir class]",
    "colgroup[]",
    "col[style]",
    "tbody[]",
    "tr[]",
    "td[colspan rowspan class]",
    "div[class data-page-break]",
    "div[class]",
  ]);
});

test.each([
  ["SVG", `<svg><image href="${X}/a"></image><rect fill="url(${X}/b)"></rect></svg>`],
  ["MathML", "<math><mi>x</mi></math>"],
  ["media", `<video poster="${X}/a" src="${X}/b" autoplay></video>`],
  ["media", `<audio src="${X}/a" autoplay></audio><track src="${X}/b">`],
  ["media", `<picture><source srcset="${X}/a"></picture>`],
  ["forms", `<form action="${X}/a"><input type="image" src="${X}/b"></form>`],
  ["forms", `<button formaction="${X}/a">b</button><select><option>o</option></select>`],
  ["forms", "<textarea>t</textarea><label>l</label><fieldset></fieldset>"],
  ["embedded content", `<iframe src="${X}/a"></iframe><object data="${X}/b"></object>`],
  ["embedded content", `<embed src="${X}/a"><canvas></canvas>`],
  ["image maps", `<map name="m"><area href="${X}/a"></map>`],
  ["top-layer and interactive elements", "<dialog open>d</dialog><details open><summary>s</summary></details>"],
])("drops %s, and every element of it", (_kind, html) => {
  // In a div: the HTML parser itself ends a paragraph at a form or a dialog.
  expect(inventory(isolated(`<div>${html}</div>`))).toEqual(["div[]"]);
});

test.each([
  ["background", `<table background="${X}/a"><tbody><tr><td background="${X}/b">x</td></tr></tbody></table>`, ["table[]", "tbody[]", "tr[]", "td[]"]],
  ["srcset and sizes", `<img src="${DATA_IMAGE}" srcset="${X}/a 2x" sizes="1px">`, ["img[src]"]],
  ["popover and its targets", '<div popover id="p">p</div><span popovertarget="p" popovertargetaction="show">s</span>', ["div[id]", "span[]"]],
  ["ping, download and cite", `<a href="${X}/a" ping="${X}/b" download>a</a><span cite="${X}/c">c</span>`, ["a[href target rel]", "span[]"]],
  ["event handlers", '<span onclick="x()" onmouseover="y()">s</span>', ["span[]"]],
  ["focus and editing", '<span tabindex="0" autofocus contenteditable="true">s</span>', ["span[]"]],
  ["legacy image sources", `<img src="${DATA_IMAGE}" lowsrc="${X}/a" dynsrc="${X}/b" usemap="#m" ismap>`, ["img[src]"]],
])("drops %s", (_kind, html, kept) => {
  expect(inventory(isolated(html))).toEqual(kept);
});

test("an image keeps its source only when it is a data: URL of an image", () => {
  const sources = (html: string) =>
    Array.from(isolated(html).querySelectorAll("img"), (img) =>
      img.getAttribute("src")
    );
  expect(
    sources(
      `<img src="${DATA_IMAGE}"><img src="  ${DATA_IMAGE}">` +
        `<img src="${X}/a"><img src="//example.invalid/b"><img src="c.png">` +
        '<img src="data:text/html,x"><img src="data:,image/png">' +
        '<img src="blob:https://example.invalid/d"><img src="">'
    )
  ).toEqual([DATA_IMAGE, DATA_IMAGE, null, null, null, null, null, null, null]);
});

test("projected HTML is held to the same lists, and keeps what isolation set on links", () => {
  const template = document.createElement("template");
  template.innerHTML = sanitizeProjectedHtml(
    '<style>p { color: red }</style><p><a href="#b" target="_blank" rel="noopener noreferrer">' +
      '<span class="oc-annot-highlight" data-annotation-id="d-1" data-label-id="l" data-label="L" style="--annot-color: red">x</span>' +
      `</a></p><svg><image href="${X}/a"></image></svg>`
  );
  expect(inventory(template.content)).toEqual([
    "p[]",
    "a[href target rel]",
    "span[class data-annotation-id data-label-id data-label style]",
  ]);
});

test("the lists are lower-case names, each once", () => {
  for (const list of [ALLOWED_TAGS, ALLOWED_ATTRIBUTES]) {
    expect(new Set(list).size).toBe(list.length);
    for (const name of list) expect(name).toMatch(/^[a-z][a-z0-9:-]*$/);
  }
});
