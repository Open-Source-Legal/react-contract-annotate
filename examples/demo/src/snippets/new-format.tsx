/**
 * README sample: the skeleton of a new format on the format contract. Kept
 * here so that it is type-checked. It shows the contract, not a renderer: it
 * draws no annotations.
 */
import {
  AnnotatorShell,
  useAllAnnotations,
  useRegisterFormatDriver,
  useScrollRequest,
  useSetDocumentStatus,
} from "@os-legal/react-contract-annotate/core";
import type {
  AnnotatorCommonProps,
  AnnotatorHandle,
} from "@os-legal/react-contract-annotate/core";
import { forwardRef, useEffect } from "react";
import type { ForwardedRef } from "react";

export interface PlainTextAnnotatorProps extends AnnotatorCommonProps {
  text: string;
}

function PlainTextFormat({ text }: { text: string }) {
  const setStatus = useSetDocumentStatus();
  const annotations = useAllAnnotations();
  const { request, complete } = useScrollRequest();

  // Tell the shell the document is shown (it fires `onDocumentLoad` and
  // renders the loading and error slots from the status).
  useEffect(() => setStatus({ state: "ready" }), [setStatus]);

  // Answer the format half of the handle.
  useRegisterFormatDriver({
    kind: "span",
    getPageCount: () => null,
    getVisiblePageRange: () => null,
    getText: () => text,
    findText: () => [],
    scrollToPage: () => false,
    resolveFitWidth: () => 1,
    canDraw: (target) =>
      target.kind === "annotation" &&
      annotations.some((a) => a.id === target.id),
  });

  // Carry out the scroll request the shell raised, then report the outcome.
  useEffect(() => {
    if (!request) return;
    const scrolled = false; // scroll to `request.target` here
    complete(request.seq, scrolled);
  }, [request, complete]);

  return <pre>{text}</pre>;
}

export const PlainTextAnnotator = forwardRef(function PlainTextAnnotator(
  { text, ...common }: PlainTextAnnotatorProps,
  ref: ForwardedRef<AnnotatorHandle>
) {
  return (
    <AnnotatorShell common={common} handleRef={ref}>
      <PlainTextFormat text={text} />
    </AnnotatorShell>
  );
});
