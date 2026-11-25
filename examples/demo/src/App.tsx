/**
 * The demo page: a switch between two real documents (a PDF and a DOCX), a
 * switch between controlled and internal state, and the workspace around the
 * viewer. The page owns what the viewer never persists: the annotations a
 * reader makes, and the ids of those the reader removes, are kept in page
 * state, per document, and the viewer is given a new array.
 */
import type {
  Annotation,
  AnnotationDraft,
  AnnotationLabel,
} from "@os-legal/react-contract-annotate";
import { useCallback, useEffect, useState } from "react";

import { DEMO_SOURCES, loadDemoDocument } from "./documents";
import type { DemoDocument } from "./documents";
import { Workspace } from "./Workspace";
import type { Mode } from "./Workspace";

const REPOSITORY_URL =
  "https://github.com/Open-Source-Legal/react-contract-annotate";

const MODES: { value: Mode; name: string }[] = [
  { value: "internal", name: "The viewer" },
  { value: "controlled", name: "This page" },
];

/** The label of a created annotation whose draft carries none. */
const UNLABELLED: AnnotationLabel = { id: "unlabelled", text: "Unlabelled" };

const NO_ANNOTATIONS: Annotation[] = [];
const NO_IDS: string[] = [];

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
  const [source, setSource] = useState(DEMO_SOURCES[0]);
  const [mode, setMode] = useState<Mode>("internal");
  const [demo, setDemo] = useState<DemoDocument | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [created, setCreated] = useState<Record<string, Annotation[]>>({});
  const [removed, setRemoved] = useState<Record<string, string[]>>({});

  useEffect(() => {
    let live = true;
    setDemo(null);
    setLoadError(null);
    loadDemoDocument(source).then(
      (loaded) => {
        if (live) setDemo(loaded);
      },
      (error: Error) => {
        if (live) setLoadError(error.message);
      }
    );
    return () => {
      live = false;
    };
  }, [source]);

  const onCreate = useCallback(
    (draft: AnnotationDraft) =>
      setCreated((all) => {
        const mine = all[source.id] ?? NO_ANNOTATIONS;
        return {
          ...all,
          [source.id]: [
            ...mine,
            annotationOf(draft, `created-${mine.length + 1}`),
          ],
        };
      }),
    [source.id]
  );

  const onRemove = useCallback(
    (annotationId: string) =>
      setRemoved((all) => ({
        ...all,
        [source.id]: [...(all[source.id] ?? NO_IDS), annotationId],
      })),
    [source.id]
  );

  return (
    <div className="demo">
      <header className="masthead">
        <div className="title">
          <h1>react-contract-annotate</h1>
          <p>
            A PDF and DOCX annotation viewer for React that ships no controls.
            Everything around the page below is this demo’s own HTML, driving
            the viewer through props, callbacks and a ref.
          </p>
        </div>
        <div className="switches">
          <span className="switch" role="group" aria-label="Document">
            {DEMO_SOURCES.map((option) => (
              <button
                key={option.id}
                type="button"
                aria-pressed={option.id === source.id}
                onClick={() => setSource(option)}
              >
                {option.name}
              </button>
            ))}
          </span>
          <span className="switch-with-name">
            <span id="state-switch">Selection and zoom are held by</span>
            <span className="switch" role="group" aria-labelledby="state-switch">
              {MODES.map(({ value, name }) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={mode === value}
                  onClick={() => setMode(value)}
                >
                  {name}
                </button>
              ))}
            </span>
          </span>
          <a href={REPOSITORY_URL}>Source and documentation on GitHub</a>
        </div>
      </header>
      {demo ? (
        <Workspace
          key={`${demo.source.id}-${mode}`}
          demo={demo}
          mode={mode}
          created={created[demo.source.id] ?? NO_ANNOTATIONS}
          removedIds={removed[demo.source.id] ?? NO_IDS}
          onCreate={onCreate}
          onRemove={onRemove}
        />
      ) : (
        <p className="status">
          {loadError === null
            ? "Loading…"
            : `The document could not be loaded: ${loadError}`}
        </p>
      )}
      <footer className="colophon">
        <p>
          Drag across text to annotate it. Click an annotation to select it, or
          pick one from the list to jump to it. The buttons beside a label copy
          the annotation’s text or remove it.
        </p>
        <p>
          The documents are model agreements published by the U.S. National
          Institutes of Health; as works of the U.S. Government they are in the
          public domain.{" "}
          <a href={source.publishedAt}>Original of this document</a>. The
          annotations are sample data made for this demo.
        </p>
      </footer>
    </div>
  );
}
