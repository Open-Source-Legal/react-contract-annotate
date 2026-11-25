import { act, render } from "@testing-library/react";
import { useStore } from "jotai";
import { createRef, useState } from "react";

import { AnnotatorShell } from "../AnnotatorShell";
import { formatDriverAtom } from "../format";
import type { AnnotatorStore } from "../state/AnnotatorProvider";
import {
  activeHighlightIdAtom,
  annotationsAtom,
  displaySettingsAtom,
  editingAtom,
  highlightsAtom,
  relationsAtom,
  selectedAnnotationIdsAtom,
  selectedRelationIdsAtom,
  zoomAtom,
} from "../state/atoms";
import type { AnnotatorHandle } from "../types";
import {
  FakeFormat,
  annotation,
  createRecorder,
  highlight,
} from "./fakeFormat";
import type { FakeRecorder } from "./fakeFormat";

const FIXTURE = [annotation("a1"), annotation("a2"), annotation("a3")];
const HIGHLIGHTS = [highlight("h1")];
const LABEL = { id: "l1", text: "Clause" };
const RENDERS = 20;

/** Captures the instance store from inside the shell. */
function StoreProbe({ onStore }: { onStore: (store: AnnotatorStore) => void }) {
  onStore(useStore());
  return null;
}

test("inline annotations array and inline callbacks every render cause no loop and no scroll", () => {
  const recorder: FakeRecorder = createRecorder();
  const handleRef = createRef<AnnotatorHandle>();
  let store!: AnnotatorStore;
  let rerenderHost!: () => void;

  function Host() {
    const [, setN] = useState(0);
    rerenderHost = () => setN((value) => value + 1);
    return (
      <AnnotatorShell
        handleRef={handleRef}
        common={{
          annotations: [...FIXTURE],
          relations: [],
          highlights: [...HIGHLIGHTS],
          selectedRelationIds: [],
          visibleLabelIds: [],
          activeLabel: { ...LABEL },
          style: { opacity: 1 },
          onSelectionChange: () => {},
          onZoomChange: () => {},
          onActiveHighlightChange: () => {},
          renderLoading: () => null,
          className: "host",
        }}
      >
        <StoreProbe onStore={(next) => (store = next)} />
        <FakeFormat recorder={recorder} />
      </AnnotatorShell>
    );
  }

  render(<Host />);

  const driver = store.get(formatDriverAtom);
  expect(driver).not.toBeNull();
  const watched = [
    formatDriverAtom,
    annotationsAtom,
    relationsAtom,
    highlightsAtom,
    selectedRelationIdsAtom,
    selectedAnnotationIdsAtom,
    displaySettingsAtom,
    editingAtom,
    zoomAtom,
    activeHighlightIdAtom,
  ] as const;
  const writes = watched.map(() => 0);
  const unsubscribe = watched.map((target, i) =>
    store.sub(target, () => {
      writes[i] += 1;
    })
  );
  const handle = handleRef.current;
  const rendersBefore = recorder.renders;

  for (let i = 0; i < RENDERS; i++) act(() => rerenderHost());
  unsubscribe.forEach((stop) => stop());

  expect(recorder.renders).toBeLessThanOrEqual(25);
  expect(recorder.renders - rendersBefore).toBe(RENDERS);
  expect(recorder.requests).toEqual([]);
  // Registered exactly once: the same driver throughout, never re-written.
  expect(store.get(formatDriverAtom)).toBe(driver);
  expect(writes).toEqual(watched.map(() => 0));
  expect(handleRef.current).toBe(handle);
});
