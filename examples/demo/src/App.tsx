/**
 * The demo page: a format switch (PDF / DOCX), a controlled / internal state
 * switch, the viewer with its controls, and a log of the viewer's callbacks.
 * The host (this component) owns what the viewer never persists: the
 * annotations the user creates are appended to host state, per format, and
 * passed back down as a new array.
 */
import type {
  Annotation,
  AnnotationDraft,
  AnnotationLabel,
} from "@os-legal/react-contract-annotate";
import { useCallback, useEffect, useState } from "react";

import { loadDemoDocument } from "./documents";
import type { DemoDocument, Format } from "./documents";
import { useEventLog } from "./eventLog";
import { Viewer } from "./Viewer";
import type { Mode } from "./Viewer";

/** The label of a created annotation whose draft carries none. */
const UNLABELLED: AnnotationLabel = { id: "unlabelled", text: "Unlabelled" };

const NO_ANNOTATIONS: Annotation[] = [];

/** The annotation a host makes of a draft the viewer reports. */
function annotationOf(draft: AnnotationDraft, id: string): Annotation {
  return {
    id,
    annotationLabel: draft.annotationLabel ?? UNLABELLED,
    rawText: draft.rawText,
    page: draft.page,
    json: draft.json,
  };
}

export function App() {
  const [format, setFormat] = useState<Format>("pdf");
  const [mode, setMode] = useState<Mode>("internal");
  const [demo, setDemo] = useState<DemoDocument | null>(null);
  const [created, setCreated] = useState<Record<Format, Annotation[]>>({
    pdf: NO_ANNOTATIONS,
    docx: NO_ANNOTATIONS,
  });
  const { events, log } = useEventLog();

  useEffect(() => {
    let live = true;
    setDemo(null);
    loadDemoDocument(format).then(
      (loaded) => {
        if (live) setDemo(loaded);
      },
      (error: Error) => log("load failed", error.message)
    );
    return () => {
      live = false;
    };
  }, [format, log]);

  const onCreate = useCallback(
    (draft: AnnotationDraft) =>
      setCreated((all) => ({
        ...all,
        [format]: [
          ...all[format],
          annotationOf(draft, `created-${all[format].length + 1}`),
        ],
      })),
    [format]
  );

  return (
    <main className="demo">
      <h1>react-contract-annotate demo</h1>
      <div className="row">
        <span className="group" role="group" aria-label="Format">
          {(["pdf", "docx"] as const).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={format === value}
              onClick={() => setFormat(value)}
            >
              {value.toUpperCase()}
            </button>
          ))}
        </span>
        <span className="group" role="group" aria-label="State">
          {(["controlled", "internal"] as const).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={mode === value}
              onClick={() => setMode(value)}
            >
              {value === "controlled" ? "Controlled" : "Internal state"}
            </button>
          ))}
        </span>
      </div>
      <p className="hint">
        Pick a label, then drag across text to create an annotation; with no
        label the selection stays pending until Escape. Shift-click an
        annotation to select it.
      </p>
      {demo ? (
        <Viewer
          key={`${format}-${mode}`}
          demo={demo}
          mode={mode}
          created={created[format]}
          onCreate={onCreate}
          log={log}
        />
      ) : (
        <p>Loading…</p>
      )}
      <pre aria-label="Last callback events">{events.join("\n")}</pre>
    </main>
  );
}
