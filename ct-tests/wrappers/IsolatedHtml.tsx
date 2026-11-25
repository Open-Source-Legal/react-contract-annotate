/**
 * Runs what the DOCX format does to converted HTML (`sanitizeDocxHtml`,
 * then `isolateDocument` with the browser's own CSS parser) on `html` and
 * shows the result as the DOCX format does: the scoped stylesheet and the
 * cleaned HTML inside the scope element, whose `data-css-rejected` says
 * whether the stylesheet failed its validation. A control outside it,
 * `[data-control]`, has an inline background image at
 * `https://example.invalid/control`, so a test can tell its request
 * interception works.
 *
 * `sanitize={false}` leaves `sanitizeDocxHtml` out: `html` goes to
 * `isolateDocument` as it is, for what must hold of that step alone.
 */
import { useState } from "react";

import { createDocxScope, isolateDocument } from "../../src/docx/isolation";
import { sanitizeDocxHtml } from "../../src/docx/loader";

const CONTROL_STYLE = {
  backgroundImage: "url(https://example.invalid/control)",
  width: 10,
  height: 10,
};

export function IsolatedHtml({
  html,
  sanitize = true,
}: {
  html: string;
  sanitize?: boolean;
}) {
  const [scope] = useState(createDocxScope);
  const isolated = isolateDocument(
    sanitize ? sanitizeDocxHtml(html) : html,
    scope
  );
  return (
    <div>
      <div
        data-rca-docx={scope.id}
        data-css-rejected={String(isolated.cssRejected)}
      >
        <style>{isolated.css}</style>
        <div dangerouslySetInnerHTML={{ __html: isolated.html }} />
      </div>
      <div data-control="" style={CONTROL_STYLE} />
    </div>
  );
}
