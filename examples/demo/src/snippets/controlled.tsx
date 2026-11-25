/**
 * README sample: controlled and internal state, and the handle. Kept here so
 * that it is type-checked.
 */
import { PdfAnnotator } from "@os-legal/react-contract-annotate/pdf";
import type {
  Annotation,
  AnnotatorHandle,
  PawlsInput,
} from "@os-legal/react-contract-annotate/pdf";
import { useRef, useState } from "react";

interface Props {
  annotations: Annotation[];
  pawls: PawlsInput;
}

/** The host owns zoom and selection: it passes them in and applies changes. */
export function ControlledViewer({ annotations, pawls }: Props) {
  const handle = useRef<AnnotatorHandle>(null);
  const [zoom, setZoom] = useState(1);
  const [selected, setSelected] = useState<string[]>([]);
  return (
    <>
      {/* The handle's setters call the change callbacks; the next render applies them. */}
      <button type="button" onClick={() => handle.current?.zoomIn()}>
        Zoom in
      </button>
      <button
        type="button"
        onClick={() =>
          void handle.current?.scrollToAnnotation("a-far", { select: true })
        }
      >
        Jump
      </button>
      <div style={{ height: 700 }}>
        <PdfAnnotator
          ref={handle}
          source={{ url: "/contract.pdf" }}
          pawls={pawls}
          annotations={annotations}
          zoom={zoom}
          onZoomChange={setZoom}
          selectedAnnotationIds={selected}
          onSelectionChange={setSelected}
        />
      </div>
    </>
  );
}

/** The viewer owns zoom and selection; the callbacks only notify. */
export function InternalViewer({ annotations, pawls }: Props) {
  return (
    <div style={{ height: 700 }}>
      <PdfAnnotator
        source={{ url: "/contract.pdf" }}
        pawls={pawls}
        annotations={annotations}
        defaultZoom="fit-width"
        defaultSelectedAnnotationIds={[]}
        onSelectionChange={(ids, { source }) => console.log(ids, source)}
      />
    </div>
  );
}
