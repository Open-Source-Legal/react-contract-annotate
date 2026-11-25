/**
 * Converts a DOCX fixture with the real docxodus runtime, the way the DOCX
 * format's loader does, and reports what the format's isolation
 * (`isolateDocument`, with the browser's own CSS parser) does to the CSS
 * docxodus wrote. The report is the JSON text of `[data-parity]`:
 * - `emitted`: every declaration of the converted document's stylesheets, as
 *   the browser parses them (`name: value`, with ` !important`), in order,
 *   through `@media`, `@supports` and `@container`;
 * - `written`: the same reading of the stylesheet the isolation returns;
 * - `droppedRules`: the kinds of the other rules docxodus wrote;
 * - `inlineEmitted` / `inlineWritten`: the declarations of each `style`
 *   attribute, as the browser parses them, before and after;
 * - `rejected`: whether the stylesheet failed its validation;
 * - `elementsEmitted` / `elementsWritten`: the tag of every element of the
 *   document's body docxodus wrote, before the sanitiser, and of every
 *   element the isolation returns, in order (stylesheets left out);
 * - `attributesLost` / `attributesAdded`: element by element, the
 *   attributes (`tag[name]`) docxodus wrote that the sanitiser and the
 *   isolation took away, and those they added;
 * - `links`: how many links (`a[href]`) docxodus wrote.
 */
import { convertDocxToHtml, initialize, PaginationMode } from "docxodus";
import { useEffect, useState } from "react";

import { isolateDocument } from "../../src/docx/isolation";
import type { DocxScope } from "../../src/docx/isolation";
import { sanitizeDocxHtml } from "../../src/docx/loader";
import { parseInDetachedDocument } from "../../src/docx/scopeStylesheet";
import { DOCXODUS_WASM_URL } from "../helpers/docxodusWasm";

export interface ParityReport {
  emitted: string[];
  written: string[];
  droppedRules: string[];
  inlineEmitted: string[];
  inlineWritten: string[];
  rejected: boolean;
  elementsEmitted: string[];
  elementsWritten: string[];
  attributesLost: string[];
  attributesAdded: string[];
  links: number;
}

/** A fixed scope, so the report does not change from run to run. */
const SCOPE: DocxScope = {
  id: "parity",
  selector: '[data-rca-docx="parity"]',
  idPrefix: "rca-parity-",
  documentPrefix: "rca-parity-docx-",
  pagePrefix: "rca-parity-page-",
};

/** The declarations of `css`, in order, and the kinds of its other rules. */
function read(css: string): { declarations: string[]; others: string[] } {
  const declarations: string[] = [];
  const others: string[] = [];
  const walk = (rules: ArrayLike<CSSRule>) => {
    for (const rule of Array.from(rules)) {
      if (rule instanceof CSSStyleRule) {
        for (const name of Array.from(rule.style)) {
          const priority = rule.style.getPropertyPriority(name);
          declarations.push(
            `${name}: ${rule.style.getPropertyValue(name)}` +
              (priority === "" ? "" : ` !${priority}`)
          );
        }
      } else if (
        rule instanceof CSSMediaRule ||
        rule instanceof CSSSupportsRule ||
        rule instanceof CSSContainerRule
      ) {
        walk(rule.cssRules);
      } else {
        others.push(rule.constructor.name);
      }
    }
  };
  walk(parseInDetachedDocument(css) ?? []);
  return { declarations, others };
}

/** The declarations of an element's `style` attribute, as parsed. */
function inlineDeclarations(element: Element): string {
  const { style } = element as HTMLElement;
  return Array.from(
    style,
    (name) => `${name}: ${style.getPropertyValue(name)}`
  ).join("; ");
}

/** The elements of `html`: its stylesheets and its `style` attributes. */
function parts(html: string): { sheets: string[]; inline: string[] } {
  const template = document.createElement("template");
  template.innerHTML = html;
  return {
    sheets: Array.from(
      template.content.querySelectorAll("style"),
      (style) => style.textContent ?? ""
    ),
    inline: Array.from(
      template.content.querySelectorAll("[style]"),
      inlineDeclarations
    ),
  };
}

/** The elements under `root` but stylesheets, in document order. */
function elementsUnder(root: ParentNode): Element[] {
  return Array.from(root.querySelectorAll("*")).filter(
    (element) => element.tagName !== "STYLE"
  );
}

/** What the sanitiser and the isolation did to the elements of `html`. */
function elementParity(html: string, isolatedHtml: string) {
  // Parsed as the document docxodus wrote; a parsed document loads nothing.
  const emitted = elementsUnder(
    new DOMParser().parseFromString(html, "text/html").body
  );
  const template = document.createElement("template");
  template.innerHTML = isolatedHtml;
  const written = elementsUnder(template.content);
  const tag = (element: Element) => element.tagName.toLowerCase();
  const attributesLost: string[] = [];
  const attributesAdded: string[] = [];
  emitted.forEach((before, index) => {
    const after = written[index];
    if (!after) return;
    const kept = new Set(after.getAttributeNames());
    for (const name of before.getAttributeNames()) {
      if (!kept.has(name)) attributesLost.push(`${tag(before)}[${name}]`);
    }
    const had = new Set(before.getAttributeNames());
    for (const name of after.getAttributeNames()) {
      if (!had.has(name)) attributesAdded.push(`${tag(after)}[${name}]`);
    }
  });
  return {
    elementsEmitted: emitted.map(tag),
    elementsWritten: written.map(tag),
    attributesLost,
    attributesAdded,
    links: emitted.filter((element) => element.matches("a[href]")).length,
  };
}

async function report(url: string): Promise<ParityReport> {
  const [, response] = await Promise.all([
    initialize(DOCXODUS_WASM_URL),
    fetch(url),
  ]);
  const html = await convertDocxToHtml(
    new Uint8Array(await response.arrayBuffer()),
    {
      paginationMode: PaginationMode.Paginated,
      cssPrefix: SCOPE.documentPrefix,
      paginationCssClassPrefix: SCOPE.pagePrefix,
    }
  );
  const sanitized = sanitizeDocxHtml(html);
  const before = parts(sanitized);
  const emitted = before.sheets.map(read);
  const isolated = isolateDocument(sanitized, SCOPE);
  return {
    emitted: emitted.flatMap((sheet) => sheet.declarations),
    written: read(isolated.css).declarations,
    droppedRules: emitted.flatMap((sheet) => sheet.others),
    inlineEmitted: before.inline,
    inlineWritten: parts(isolated.html).inline,
    rejected: isolated.cssRejected,
    ...elementParity(html, isolated.html),
  };
}

export function DocxParity({ url }: { url: string }) {
  const [result, setResult] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    report(url).then(
      (value) => live && setResult(JSON.stringify(value)),
      (reason: unknown) => live && setResult(`error: ${String(reason)}`)
    );
    return () => {
      live = false;
    };
  }, [url]);
  return result === null ? null : <pre data-parity="">{result}</pre>;
}
