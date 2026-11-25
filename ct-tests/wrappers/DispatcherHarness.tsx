/**
 * The dispatcher test harness: a 900 x 700 box with the root entry's
 * `DocumentAnnotator` showing the PDF fixture (`fixtures/eton`, with its
 * PAWLs, annotations and relations) or the DOCX one (`fixtures/docx/test.docx`
 * with its text and annotations), fetched at runtime from `/fixtures/**`
 * (served by `serveFixtures`), and docxodus' runtime from `DOCXODUS_WASM_URL`
 * (served by `setupDocxodusWasm`). Like the format harnesses, it exposes the
 * handle and a log of every callback on `window` (see `helpers/harness.ts`);
 * the harness named `"default"` also uses the short names `window.__rca` /
 * `window.__rcaEvents`.
 *
 * `format` picks the document. When it changes (`component.update(...)`) the
 * previous document stays shown until the new one's data has been fetched,
 * then the dispatcher is given the new document: a format change mounts a
 * fresh viewer.
 */
import { useEffect, useState } from "react";
import type { CSSProperties } from "react";

import { DocumentAnnotator } from "../../src/index";
import type { Annotation, DocumentInput, Relation } from "../../src/index";
import { DOCXODUS_WASM_URL } from "../helpers/docxodusWasm";
import {
  DEFAULT_NAME,
  eventLog,
  loggedCallbacks,
  useHandleSetter,
} from "./harnessShared";

export interface DispatcherHarnessProps {
  format: DocumentInput["format"];
  /** Addresses the harness from the test; default `"default"`. */
  name?: string;
}

const SIZE: CSSProperties = { width: 900, height: 700, flex: "none" };

const FIXTURES = {
  pdf: {
    pdf: "/fixtures/eton/eton-agreement.pdf",
    pawls: "/fixtures/eton/pawls.json",
    annotations: "/fixtures/eton/annotations.json",
    relations: "/fixtures/eton/relations.json",
  },
  docx: {
    docx: "/fixtures/docx/test.docx",
    text: "/fixtures/docx/text.txt",
    annotations: "/fixtures/docx/annotations.json",
  },
} as const;

/** What the dispatcher is given for one document. */
type Shown = {
  document: DocumentInput;
  annotations: Annotation[];
  relations: Relation[];
};

async function fetchOk(url: string): Promise<Response> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return response;
}

async function fetchShown(format: DocumentInput["format"]): Promise<Shown> {
  if (format === "pdf") {
    const files = FIXTURES.pdf;
    const [pawls, annotations, relations] = await Promise.all([
      fetchOk(files.pawls).then((r) => r.json()),
      fetchOk(files.annotations).then((r) => r.json()),
      fetchOk(files.relations).then((r) => r.json()),
    ]);
    return {
      document: { format, source: { url: files.pdf }, pawls },
      annotations,
      relations,
    };
  }
  const files = FIXTURES.docx;
  const [text, annotations] = await Promise.all([
    fetchOk(files.text).then((r) => r.text()),
    fetchOk(files.annotations).then((r) => r.json()),
  ]);
  return {
    document: {
      format,
      source: { url: files.docx },
      text,
      wasmBaseUrl: DOCXODUS_WASM_URL,
    },
    annotations,
    relations: [],
  };
}

export function DispatcherHarness({
  format,
  name = DEFAULT_NAME,
}: DispatcherHarnessProps) {
  const [shown, setShown] = useState<Shown | null>(null);
  // Created during the first render: the annotator's own effects can fire
  // callbacks before any effect of this component runs.
  const [log] = useState(() => eventLog(name));
  const setHandle = useHandleSetter(name);

  useEffect(() => {
    let live = true;
    void fetchShown(format).then((next) => {
      if (live) setShown(next);
    });
    return () => {
      live = false;
    };
  }, [format]);

  if (!shown) return <div data-harness={name} style={SIZE} />;

  return (
    <div data-harness={name} style={SIZE}>
      <DocumentAnnotator
        ref={setHandle}
        document={shown.document}
        annotations={shown.annotations}
        relations={shown.relations}
        {...loggedCallbacks(log, {}, [])}
      />
    </div>
  );
}
