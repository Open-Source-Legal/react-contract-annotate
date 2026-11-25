/**
 * Runs the DOCX format's isolation (`isolateDocument`, with the browser's
 * own CSS parser) on `html` and shows the result as the DOCX format does:
 * the scoped stylesheet and the cleaned HTML inside the scope element. A
 * control outside it, `[data-control]`, has an inline background image at
 * `https://example.invalid/control`, so a test can tell its request
 * interception works.
 */
import { useState } from "react";

import { createDocxScope, isolateDocument } from "../../src/docx/isolation";

const CONTROL_STYLE = {
  backgroundImage: "url(https://example.invalid/control)",
  width: 10,
  height: 10,
};

export function IsolatedHtml({ html }: { html: string }) {
  const [scope] = useState(createDocxScope);
  const isolated = isolateDocument(html, scope);
  return (
    <div>
      <div data-rca-docx={scope.id}>
        <style>{isolated.css}</style>
        <div dangerouslySetInnerHTML={{ __html: isolated.html }} />
      </div>
      <div data-control="" style={CONTROL_STYLE} />
    </div>
  );
}
