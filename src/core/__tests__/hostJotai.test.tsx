/**
 * A host that uses Jotai itself keeps its own Jotai context inside the
 * annotator: content it renders in a slot reads and writes the host's
 * atoms, and the annotator's state never lands in the host's store
 * (issue #8). The host side below uses Jotai the ordinary way, through its
 * own `<Provider>` or the default store.
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import {
  atom,
  createStore,
  getDefaultStore,
  Provider,
  useAtomValue,
  useSetAtom,
} from "jotai";
import { createRef } from "react";
import type { ReactNode } from "react";

import { instanceIdAtom } from "../state/atoms";
import type { AnnotatorCommonProps, AnnotatorHandle } from "../types";
import {
  annotation,
  createRecorder,
  FakeAnnotator,
  LOADING,
} from "./fakeFormat";
import type { FakeStatus } from "./fakeFormat";

/** A host atom: what a host's own state looks like. */
const hostLabelAtom = atom("initial");

function HostReader() {
  return <span data-testid="host-value">{useAtomValue(hostLabelAtom)}</span>;
}

function HostWriter() {
  const set = useSetAtom(hostLabelAtom);
  return (
    <button
      data-testid="host-write"
      onClick={() => set("written in a slot")}
    />
  );
}

interface MountOptions {
  /** Puts the host's providers around the viewer. */
  wrap?: (node: ReactNode) => ReactNode;
  status?: FakeStatus;
}

function mount(
  common: Partial<AnnotatorCommonProps>,
  { wrap, status }: MountOptions = {}
) {
  const viewer = (
    <FakeAnnotator
      common={{ annotations: [annotation("a1")], ...common }}
      fake={{ recorder: createRecorder(), status }}
      handleRef={createRef<AnnotatorHandle>()}
    />
  );
  const view = render(<>{wrap ? wrap(viewer) : viewer}</>);
  const select = () =>
    fireEvent.click(view.container.querySelector("[data-fake-select]")!);
  return { select };
}

test("a selection-menu slot reads the host's own Jotai Provider", () => {
  const hostStore = createStore();
  hostStore.set(hostLabelAtom, "from the host");
  const { select } = mount(
    { renderSelectionMenu: () => <HostReader /> },
    { wrap: (node) => <Provider store={hostStore}>{node}</Provider> }
  );

  select();

  expect(screen.getByTestId("host-value").textContent).toBe(
    "from the host"
  );
});

test("slot content writes to the host's store", () => {
  const hostStore = createStore();
  const { select } = mount(
    { renderSelectionMenu: () => <HostWriter /> },
    { wrap: (node) => <Provider store={hostStore}>{node}</Provider> }
  );

  select();
  act(() => fireEvent.click(screen.getByTestId("host-write")));

  expect(hostStore.get(hostLabelAtom)).toBe("written in a slot");
});

test("a loading slot reads the host's Jotai Provider", () => {
  const hostStore = createStore();
  hostStore.set(hostLabelAtom, "while loading");
  mount(
    { renderLoading: () => <HostReader /> },
    {
      status: LOADING,
      wrap: (node) => <Provider store={hostStore}>{node}</Provider>,
    }
  );

  expect(screen.getByTestId("host-value").textContent).toBe(
    "while loading"
  );
});

test("without a host Provider, a slot reads Jotai's default store", () => {
  const defaultStore = getDefaultStore();
  defaultStore.set(hostLabelAtom, "in the default store");
  try {
    const { select } = mount({ renderSelectionMenu: () => <HostReader /> });

    select();

    expect(screen.getByTestId("host-value").textContent).toBe(
      "in the default store"
    );
  } finally {
    defaultStore.set(hostLabelAtom, "initial");
  }
});

test("the annotator's own state stays out of the host's store", () => {
  const hostStore = createStore();
  mount(
    { renderSelectionMenu: () => <HostReader /> },
    { wrap: (node) => <Provider store={hostStore}>{node}</Provider> }
  );

  // The instance id is set in the annotator's store on mount; the host's
  // store still holds the atom's initial value.
  expect(hostStore.get(instanceIdAtom)).toBe("");
});
