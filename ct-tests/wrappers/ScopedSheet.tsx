/**
 * Runs the DOCX format's stylesheet scoper (`scopeStylesheet`, with the
 * browser's own CSS parser and the custom properties a document keeps) on
 * `css` and inserts the result where the DOCX
 * format does: in a `<style>` inside the scope element
 * `[data-rca-docx="<scopeId>"]`. Probes sit outside it:
 * `[data-probe-sibling]` (the scope element's next sibling, where the
 * shell's slots and the host's menu would be) and `[data-probe-z]` (class
 * `z`).
 */
import { DOCUMENT_CUSTOM_PROPERTIES } from "../../src/docx/constants";
import { scopeStylesheet } from "../../src/docx/scopeStylesheet";

export function ScopedSheet({
  css,
  scopeId,
}: {
  css: string;
  scopeId: string;
}) {
  return (
    <div data-scoped-sheet="">
      <div data-rca-docx={scopeId}>
        <style>
          {
            scopeStylesheet(css, `[data-rca-docx="${scopeId}"]`, {
              customProperties: DOCUMENT_CUSTOM_PROPERTIES,
            }).css
          }
        </style>
        <p>inside</p>
      </div>
      <div data-probe-sibling="">sibling</div>
      <p className="z" data-probe-z="">
        z
      </p>
    </div>
  );
}
