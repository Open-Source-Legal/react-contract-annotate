import { act, render, waitFor } from "@testing-library/react";
import { createRef } from "react";

import { DocumentAnnotator } from "../DocumentAnnotator";
import type {
  AnnotatorHandle,
  DocumentInput,
  PawlsPage,
} from "../core/index";

// Stand-ins for the two engines: each records the props it gets and how often
// it was mounted, and a gate holds back the module's evaluation so a test can
// look at the dispatcher while a format's chunk is still loading. A gate
// opened (or a module loaded) stays so for the rest of the file, which is why
// the two tests that look at the loading state come first.
const fakes = vi.hoisted(() => {
  const gate = () => {
    let open!: () => void;
    const opened = new Promise<void>((resolve) => {
      open = resolve;
    });
    return { opened, open };
  };
  return {
    pdf: { ...gate(), loads: 0, mounts: 0, props: [] as unknown[] },
    docx: { ...gate(), loads: 0, mounts: 0, props: [] as unknown[] },
  };
});

function fakeHandle(format: string): AnnotatorHandle {
  return { getText: () => format } as unknown as AnnotatorHandle;
}

vi.mock("../pdf/index", async () => {
  const { createElement, forwardRef, useEffect, useImperativeHandle } =
    await import("react");
  fakes.pdf.loads++;
  await fakes.pdf.opened;
  return {
    PdfAnnotator: forwardRef<AnnotatorHandle, Record<string, unknown>>(
      function FakePdf(props, ref) {
        fakes.pdf.props.push(props);
        useImperativeHandle(ref, () => fakeHandle("pdf"));
        useEffect(() => {
          fakes.pdf.mounts++;
        }, []);
        return createElement("div", { "data-fake": "pdf" });
      }
    ),
  };
});

vi.mock("../docx/index", async () => {
  const { createElement, forwardRef, useEffect, useImperativeHandle } =
    await import("react");
  fakes.docx.loads++;
  await fakes.docx.opened;
  return {
    DocxAnnotator: forwardRef<AnnotatorHandle, Record<string, unknown>>(
      function FakeDocx(props, ref) {
        fakes.docx.props.push(props);
        useImperativeHandle(ref, () => fakeHandle("docx"));
        useEffect(() => {
          fakes.docx.mounts++;
        }, []);
        return createElement("div", { "data-fake": "docx" });
      }
    ),
  };
});

const PDF_SOURCE = { url: "/a.pdf" };
const PAWLS: PawlsPage[] = [];
const PDF_DOCUMENT: DocumentInput = {
  format: "pdf",
  source: PDF_SOURCE,
  pawls: PAWLS,
  enableNativeLinks: false,
};

const DOCX_SOURCE = { url: "/a.docx" };
const DOCX_DOCUMENT: DocumentInput = {
  format: "docx",
  source: DOCX_SOURCE,
  text: "Hello",
  wasmBaseUrl: "/wasm/",
};

const COMMON = { annotations: [] };

const fake = (container: HTMLElement, format: string) =>
  container.querySelector(`[data-fake="${format}"]`);

test("while the PDF chunk loads, renderLoading(null) stands in; the DOCX engine is never loaded", async () => {
  const renderLoading = vi.fn((progress: number | null) => (
    <i data-loading={String(progress)} />
  ));
  const { container } = render(
    <DocumentAnnotator
      {...COMMON}
      document={PDF_DOCUMENT}
      renderLoading={renderLoading}
    />
  );

  expect(container.querySelector("[data-loading]")?.getAttribute("data-loading"))
    .toBe("null");
  expect(renderLoading).toHaveBeenCalledWith(null);
  expect(fake(container, "pdf")).toBeNull();

  await act(async () => fakes.pdf.open());
  await waitFor(() => expect(fake(container, "pdf")).not.toBeNull());
  expect(container.querySelector("[data-loading]")).toBeNull();
  expect(fakes.docx.loads).toBe(0);
});

test("without renderLoading nothing is rendered while the DOCX chunk loads", async () => {
  const { container } = render(
    <DocumentAnnotator {...COMMON} document={DOCX_DOCUMENT} />
  );
  expect(container.innerHTML).toBe("");

  await act(async () => fakes.docx.open());
  await waitFor(() => expect(fake(container, "docx")).not.toBeNull());
});

test("a PDF document renders the PDF annotator with its inputs and the common props, not the DOCX ones", async () => {
  const onError = vi.fn();
  const { container } = render(
    <DocumentAnnotator
      {...COMMON}
      document={PDF_DOCUMENT}
      onError={onError}
      showStructural
    />
  );
  await waitFor(() => expect(fake(container, "pdf")).not.toBeNull());

  const props = fakes.pdf.props.at(-1);
  expect(props).toMatchObject({
    annotations: COMMON.annotations,
    onError,
    showStructural: true,
    source: PDF_SOURCE,
    pawls: PAWLS,
    enableNativeLinks: false,
  });
  expect(props).not.toHaveProperty("document");
  expect(props).not.toHaveProperty("format");
  expect(props).not.toHaveProperty("text");
  expect(fake(container, "docx")).toBeNull();
});

test("a DOCX document renders the DOCX annotator with its inputs and the common props, not the PDF ones", async () => {
  const onError = vi.fn();
  const { container } = render(
    <DocumentAnnotator {...COMMON} document={DOCX_DOCUMENT} onError={onError} />
  );
  await waitFor(() => expect(fake(container, "docx")).not.toBeNull());

  const props = fakes.docx.props.at(-1);
  expect(props).toMatchObject({
    annotations: COMMON.annotations,
    onError,
    source: DOCX_SOURCE,
    text: "Hello",
    wasmBaseUrl: "/wasm/",
  });
  expect(props).not.toHaveProperty("document");
  expect(props).not.toHaveProperty("format");
  expect(props).not.toHaveProperty("pawls");
  expect(fake(container, "pdf")).toBeNull();
});

test("the ref is the handle of the mounted viewer", async () => {
  const ref = createRef<AnnotatorHandle>();
  const { container } = render(
    <DocumentAnnotator ref={ref} {...COMMON} document={PDF_DOCUMENT} />
  );
  await waitFor(() => expect(fake(container, "pdf")).not.toBeNull());
  expect(ref.current?.getText()).toBe("pdf");
});

test("a change of format unmounts one viewer and mounts the other afresh", async () => {
  const ref = createRef<AnnotatorHandle>();
  const view = render(
    <DocumentAnnotator ref={ref} {...COMMON} document={PDF_DOCUMENT} />
  );
  await waitFor(() => expect(fake(view.container, "pdf")).not.toBeNull());
  const pdfMounts = fakes.pdf.mounts;

  view.rerender(
    <DocumentAnnotator ref={ref} {...COMMON} document={DOCX_DOCUMENT} />
  );
  await waitFor(() => expect(fake(view.container, "docx")).not.toBeNull());
  expect(fake(view.container, "pdf")).toBeNull();
  expect(ref.current?.getText()).toBe("docx");

  view.rerender(
    <DocumentAnnotator ref={ref} {...COMMON} document={PDF_DOCUMENT} />
  );
  await waitFor(() => expect(fake(view.container, "pdf")).not.toBeNull());
  expect(fake(view.container, "docx")).toBeNull();
  expect(ref.current?.getText()).toBe("pdf");
  expect(fakes.pdf.mounts).toBe(pdfMounts + 1);
});
