import { act, render, renderHook } from "@testing-library/react";
import { createRef } from "react";

import { AnnotatorShell } from "../AnnotatorShell";
import { DOCUMENT_ERROR_MESSAGE } from "../constants";
import {
  useActiveHighlightId,
  useDevWarnOnce,
  useDisplaySettings,
  useDocumentStatus,
  useEditing,
  useHighlights,
  useRootElement,
  useSelectedAnnotationIds,
  useSetDocumentStatus,
  useZoom,
} from "../formatHooks";
import type { AnnotatorCommonProps, AnnotatorHandle } from "../types";
import { annotation, highlight } from "./fakeFormat";

const LABEL = { id: "l1", text: "Clause" };
const HIGHLIGHTS = [highlight("h1"), highlight("h2")];

type Seen = {
  zoom: number;
  display: ReturnType<typeof useDisplaySettings>;
  editing: ReturnType<typeof useEditing>;
  root: HTMLElement | null;
  status: ReturnType<typeof useDocumentStatus>;
  setStatus: ReturnType<typeof useSetDocumentStatus>;
  selected: string[];
  highlights: ReturnType<typeof useHighlights>;
  activeHighlightId: string | null;
};

/** A format-side component that reads everything through the hooks. */
function Probe({ seen }: { seen: Partial<Seen> }) {
  seen.zoom = useZoom();
  seen.display = useDisplaySettings();
  seen.editing = useEditing();
  seen.root = useRootElement();
  seen.status = useDocumentStatus();
  seen.setStatus = useSetDocumentStatus();
  seen.selected = useSelectedAnnotationIds();
  seen.highlights = useHighlights();
  seen.activeHighlightId = useActiveHighlightId();
  return null;
}

function setup(common: Partial<AnnotatorCommonProps> = {}) {
  const seen: Partial<Seen> = {};
  const handleRef = createRef<AnnotatorHandle>();
  const view = render(
    <AnnotatorShell
      common={{ annotations: [annotation("a1")], ...common }}
      handleRef={handleRef}
    >
      <Probe seen={seen} />
    </AnnotatorShell>
  );
  return { seen: seen as Seen, container: view.container };
}

test("each hook reads the value the shell synced from props", () => {
  const { seen, container } = setup({
    zoom: 1.5,
    showStructural: true,
    labelDisplay: "always",
    visibleLabelIds: ["l1"],
    readOnly: true,
    activeLabel: LABEL,
    selectedAnnotationIds: ["a1"],
    highlights: HIGHLIGHTS,
    activeHighlightId: "h2",
  });

  expect(seen.zoom).toBe(1.5);
  expect(seen.display).toEqual({
    showStructural: true,
    showStructuralRelationships: false,
    showSelectedOnly: false,
    showBoundingBoxes: true,
    labelDisplay: "always",
    visibleLabelIds: ["l1"],
  });
  expect(seen.editing).toEqual({ readOnly: true, activeLabel: LABEL });
  expect(seen.root).toBe(container.querySelector("[data-rca-root]"));
  expect(seen.status).toEqual({ state: "loading", progress: null, error: null });
  expect(seen.selected).toEqual(["a1"]);
  expect(seen.highlights).toBe(HIGHLIGHTS);
  expect(seen.activeHighlightId).toBe("h2");
});

test("useSetDocumentStatus updates the status, filling defaults", () => {
  const { seen } = setup();

  act(() => seen.setStatus({ state: "loading", progress: 30 }));
  expect(seen.status).toEqual({ state: "loading", progress: 30, error: null });

  act(() => seen.setStatus({ state: "ready" }));
  expect(seen.status).toEqual({ state: "ready", progress: null, error: null });

  const boom = new Error("boom");
  act(() => seen.setStatus({ state: "error", error: boom }));
  expect(seen.status.error).toBe(boom);
});

test("an error reported without an Error records a generic one, kept on repeat", () => {
  const { seen } = setup();
  act(() => seen.setStatus({ state: "error" }));
  const first = seen.status;
  expect(first.state).toBe("error");
  expect(first.error).toBeInstanceOf(Error);
  expect(first.error?.message).toBe(DOCUMENT_ERROR_MESSAGE);

  act(() => seen.setStatus({ state: "error" }));
  expect(seen.status).toBe(first);
});

/** Calls the warn-once function it gets with `key` on every render. */
function Warner({ keyName }: { keyName: string }) {
  const warnOnce = useDevWarnOnce();
  warnOnce(keyName, `warning ${keyName}`);
  return null;
}

test("useDevWarnOnce warns once per key and annotator", () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const mount = (keyName: string) => (
    <AnnotatorShell common={{ annotations: [] }} handleRef={null}>
      <Warner keyName={keyName} />
    </AnnotatorShell>
  );

  const first = render(mount("zoom"));
  first.rerender(mount("zoom"));
  first.rerender(mount("page"));
  render(mount("zoom"));

  expect(warn.mock.calls.map((call) => call[0])).toEqual([
    "warning zoom",
    "warning page",
    "warning zoom",
  ]);
  warn.mockRestore();
});

const HOOKS: [string, () => unknown][] = [
  ["useZoom", () => useZoom()],
  ["useDisplaySettings", () => useDisplaySettings()],
  ["useEditing", () => useEditing()],
  ["useRootElement", () => useRootElement()],
  ["useDocumentStatus", () => useDocumentStatus()],
  ["useSetDocumentStatus", () => useSetDocumentStatus()],
  ["useSelectedAnnotationIds", () => useSelectedAnnotationIds()],
  ["useHighlights", () => useHighlights()],
  ["useActiveHighlightId", () => useActiveHighlightId()],
  ["useDevWarnOnce", () => useDevWarnOnce()],
];

test.each(HOOKS)("%s throws outside an annotator", (name, hook) => {
  // React re-throws a render error through a window "error" event (which
  // jsdom would print) and then logs it; keep the test output clean.
  const swallow = (event: ErrorEvent) => event.preventDefault();
  window.addEventListener("error", swallow);
  const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    expect(() => renderHook(hook)).toThrow(
      `${name} must be used inside an annotator`
    );
  } finally {
    consoleError.mockRestore();
    window.removeEventListener("error", swallow);
  }
});
