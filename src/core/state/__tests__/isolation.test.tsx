import { act, render } from "@testing-library/react";
import { useStore } from "jotai";

import { AnnotatorProvider } from "../AnnotatorProvider";
import {
  annotationsAtom,
  DEFAULT_DISPLAY_SETTINGS,
  displaySettingsAtom,
  instanceIdAtom,
  zoomAtom,
} from "../atoms";
import {
  useControllable,
  useLastUserValue,
  useSetControllable,
} from "../controllable";

type Store = ReturnType<typeof useStore>;

type Probe = {
  store: Store;
  setZoom: (next: number, info: { source: "user" | "api" }) => void;
  lastUserZoom: { current: number | undefined };
};

/** Mounts a provider whose probe captures its store and zoom handles. */
function Instance({
  probe,
  zoom,
  onZoomChange,
}: {
  probe: Partial<Probe>;
  zoom?: number;
  onZoomChange?: (next: number) => void;
}) {
  return (
    <AnnotatorProvider>
      <ZoomProbe probe={probe} zoom={zoom} onZoomChange={onZoomChange} />
    </AnnotatorProvider>
  );
}

function ZoomProbe({
  probe,
  zoom,
  onZoomChange,
}: {
  probe: Partial<Probe>;
  zoom?: number;
  onZoomChange?: (next: number) => void;
}) {
  useControllable<number>("zoom", {
    value: zoom,
    defaultValue: 1,
    onChange: onZoomChange,
  });
  probe.store = useStore();
  probe.setZoom = useSetControllable<number>("zoom");
  probe.lastUserZoom = useLastUserValue<number>("zoom");
  return null;
}

test("two providers do not share state", () => {
  const first: Partial<Probe> = {};
  const second: Partial<Probe> = {};
  render(
    <>
      <Instance probe={first} />
      <Instance probe={second} />
    </>
  );
  expect(first.store).not.toBe(second.store);

  act(() => first.store!.set(zoomAtom, 2));

  expect(first.store!.get(zoomAtom)).toBe(2);
  expect(second.store!.get(zoomAtom)).toBe(1);
});

test("each provider gets its own instance id", () => {
  const first: Partial<Probe> = {};
  const second: Partial<Probe> = {};
  render(
    <>
      <Instance probe={first} />
      <Instance probe={second} />
    </>
  );
  const a = first.store!.get(instanceIdAtom);
  const b = second.store!.get(instanceIdAtom);
  expect(a).not.toBe("");
  expect(b).not.toBe("");
  expect(a).not.toBe(b);
});

test("controlled-ness, callbacks and last user value are per instance", () => {
  const first: Partial<Probe> = {};
  const second: Partial<Probe> = {};
  const onFirst = vi.fn();
  const onSecond = vi.fn();
  render(
    <>
      <Instance probe={first} zoom={1.5} onZoomChange={onFirst} />
      <Instance probe={second} onZoomChange={onSecond} />
    </>
  );

  act(() => first.setZoom!(2, { source: "user" }));

  // First is controlled: notified, atom untouched, user value recorded.
  expect(onFirst).toHaveBeenCalledTimes(1);
  expect(first.store!.get(zoomAtom)).toBe(1.5);
  expect(first.lastUserZoom!.current).toBe(2);
  // Second saw none of it.
  expect(onSecond).not.toHaveBeenCalled();
  expect(second.store!.get(zoomAtom)).toBe(1);
  expect(second.lastUserZoom!.current).toBeUndefined();

  act(() => second.setZoom!(3, { source: "user" }));

  // Second is uncontrolled: its atom changes, the first one's does not.
  expect(second.store!.get(zoomAtom)).toBe(3);
  expect(onSecond).toHaveBeenCalledTimes(1);
  expect(first.store!.get(zoomAtom)).toBe(1.5);
  expect(onFirst).toHaveBeenCalledTimes(1);
});

test("initial values are immutable, so one instance cannot corrupt another's defaults", () => {
  const first: Partial<Probe> = {};
  const second: Partial<Probe> = {};
  render(
    <>
      <Instance probe={first} />
      <Instance probe={second} />
    </>
  );

  const annotations = first.store!.get(annotationsAtom);
  expect(() => (annotations as unknown[]).push({})).toThrow(TypeError);
  expect(() => {
    (first.store!.get(displaySettingsAtom) as { showStructural: boolean })
      .showStructural = true;
  }).toThrow(TypeError);

  expect(second.store!.get(annotationsAtom)).toEqual([]);
  expect(second.store!.get(displaySettingsAtom).showStructural).toBe(false);
});

test("display settings default to the documented values", () => {
  expect(DEFAULT_DISPLAY_SETTINGS).toEqual({
    showStructural: false,
    showStructuralRelationships: false,
    showSelectedOnly: false,
    showBoundingBoxes: true,
    labelDisplay: "hover",
    visibleLabelIds: null,
  });
});
