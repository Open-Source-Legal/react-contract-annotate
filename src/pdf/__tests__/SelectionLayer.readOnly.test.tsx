/**
 * The selection layer under `readOnly`. Ported from OpenContracts'
 * `SelectionLayer.permissions.test.tsx` (98286cabf), whose layer took
 * `read_only` and corpus permissions: the library has no corpus, so what is
 * left is `readOnly`, and the outcome is now checked rather than only that the
 * layer renders. A read-only annotator still lets the user drag-select text
 * and reports it to `onTextSelect` (OpenContracts: "allow selection for
 * copying even in read-only mode"); it never calls `onCreateAnnotation`.
 */
import type { AnnotationLabel, PendingSelection } from "../../core/index";
import { IN_HELLO, IN_WORLD, LAYER, drag, renderLayers } from "./selectionFixture";

vi.mock("pdfjs-dist/legacy/build/pdf.mjs", async () => {
  const { fakePdfjs: fake } = await import("./pdfjsFake");
  return { getDocument: fake.getDocument, GlobalWorkerOptions: {} };
});

const ACTIVE: AnnotationLabel = Object.freeze({
  id: "label-1",
  text: "Test Label",
  color: "#0066cc",
});

const PENDING_REGION = "[data-rca-pending-region]";

test("renders the selection layer around the page", () => {
  const { container, layer } = renderLayers({ readOnly: true });
  expect(container.querySelector(LAYER)).not.toBeNull();
  // The layer wraps the page's canvas and whatever is drawn over it.
  expect(layer().querySelector("canvas")).not.toBeNull();
});

test("readOnly with an active label: a drag is reported to onTextSelect and nothing is created", () => {
  const onTextSelect = vi.fn();
  const onCreateAnnotation = vi.fn();
  const { layer } = renderLayers({
    readOnly: true,
    activeLabel: ACTIVE,
    onTextSelect,
    onCreateAnnotation,
  });

  drag(layer(), IN_HELLO, IN_WORLD);

  expect(onTextSelect).toHaveBeenCalledTimes(1);
  expect((onTextSelect.mock.calls[0][0] as PendingSelection).rawText).toBe(
    "Hello world"
  );
  expect(onCreateAnnotation).not.toHaveBeenCalled();
  // It stays pending (outcome 3) and is painted.
  expect(layer().querySelectorAll(PENDING_REGION)).toHaveLength(1);
});

test("readOnly: committing from onTextSelect creates nothing either", () => {
  const onCreateAnnotation = vi.fn();
  const { layer } = renderLayers({
    readOnly: true,
    activeLabel: ACTIVE,
    onTextSelect: (_pending, actions) => actions.commit(),
    onCreateAnnotation,
  });

  drag(layer(), IN_HELLO, IN_WORLD);

  expect(onCreateAnnotation).not.toHaveBeenCalled();
});

test("not readOnly with an active label: the drag is committed with that label", () => {
  const onCreateAnnotation = vi.fn();
  const { layer } = renderLayers({
    activeLabel: ACTIVE,
    onCreateAnnotation,
  });

  drag(layer(), IN_HELLO, IN_WORLD);

  expect(onCreateAnnotation).toHaveBeenCalledTimes(1);
  expect(onCreateAnnotation.mock.calls[0][0]).toMatchObject({
    rawText: "Hello world",
    page: 0,
    annotationLabel: ACTIVE,
  });
  expect(layer().querySelectorAll(PENDING_REGION)).toHaveLength(0);
});

test("without an active label the drag is reported and stays pending", () => {
  const onTextSelect = vi.fn();
  const onCreateAnnotation = vi.fn();
  const { layer } = renderLayers({ onTextSelect, onCreateAnnotation });

  drag(layer(), IN_HELLO, IN_WORLD);

  expect(onTextSelect).toHaveBeenCalledTimes(1);
  expect(onCreateAnnotation).not.toHaveBeenCalled();
  const region = layer().querySelector(PENDING_REGION);
  expect(region?.getAttribute("data-rca-page-part")).toBe("0");
  expect(layer().querySelectorAll("[data-rca-pending-token]")).toHaveLength(2);
});
