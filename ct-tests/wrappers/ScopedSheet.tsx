/**
 * Runs the DOCX format's stylesheet scoper (`scopeStylesheets`, with the
 * browser's own CSS parser) on `css` (one stylesheet, or one per `<style>`
 * block of a document) and inserts the result where the DOCX format does:
 * in a `<style>` inside the scope element `[data-rca-docx="<scopeId>"]`,
 * whose `data-css-rejected` says whether the result failed its validation.
 * Probes sit outside it: `[data-probe-sibling]` (the scope element's next
 * sibling, where the shell's slots and the host's menu would be),
 * `[data-probe-z]` (class `z`), and two fixed boxes standing at the same
 * place: `[data-probe-anchored]`, which the host positions against the
 * anchor named `--menu` (it stays where it stands while nothing has that
 * name), and `[data-probe-unanchored]`, against a name nothing has. A
 * control, `[data-control]`, has an inline background image at
 * `https://example.invalid/control`, so a test can tell its request
 * interception works. The wrapper is a query container of the host's.
 */
import { scopeStylesheets } from "../../src/docx/scopeStylesheet";

const HOST_STYLE = { containerType: "inline-size" } as const;
const anchoredTo = (name: string) =>
  ({
    position: "fixed",
    positionAnchor: name,
    left: "anchor(left)",
    top: "anchor(bottom)",
  }) as const;
const ANCHORED_STYLE = anchoredTo("--menu");
const UNANCHORED_STYLE = anchoredTo("--rca-test-no-such-anchor");
const CONTROL_STYLE = {
  backgroundImage: "url(https://example.invalid/control)",
  width: 10,
  height: 10,
};

export function ScopedSheet({
  css,
  scopeId,
}: {
  css: string | string[];
  scopeId: string;
}) {
  const scoped = scopeStylesheets(
    typeof css === "string" ? [css] : css,
    `[data-rca-docx="${scopeId}"]`
  );
  return (
    <div data-scoped-sheet="" style={HOST_STYLE}>
      <div data-probe-anchored="" style={ANCHORED_STYLE}>
        anchored
      </div>
      <div data-probe-unanchored="" style={UNANCHORED_STYLE}>
        anchored
      </div>
      <div data-rca-docx={scopeId} data-css-rejected={String(scoped.rejected)}>
        <style>{scoped.css}</style>
        <p>inside</p>
      </div>
      <div data-probe-sibling="">sibling</div>
      <p className="z" data-probe-z="">
        z
      </p>
      <div data-control="" style={CONTROL_STYLE} />
    </div>
  );
}
