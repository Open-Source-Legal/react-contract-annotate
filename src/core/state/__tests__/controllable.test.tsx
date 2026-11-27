import { act, render, renderHook } from "@testing-library/react";
import { StrictMode, useLayoutEffect, useEffect, useState } from "react";
import type { ReactNode } from "react";

import type { ChangeInfo } from "../../types";
import {
  AnnotatorProvider,
  useAnnotatorStore,
} from "../AnnotatorProvider";
import type { AnnotatorStore } from "../AnnotatorProvider";
import {
  activeHighlightIdAtom,
  selectedAnnotationIdsAtom,
  zoomAtom,
} from "../atoms";
import {
  useControllable,
  useLastUserValue,
  useSetControllable,
} from "../controllable";

const USER: ChangeInfo = { source: "user" };
const API: ChangeInfo = { source: "api" };

const shallowEqualArrays = (a: string[], b: string[]) =>
  a.length === b.length && a.every((item, i) => item === b[i]);

type ZoomProps = {
  value: number | undefined;
  defaultValue: number;
  onChange?: (next: number, info: ChangeInfo) => void;
};

/** One zoom bridge plus the handles a test needs to poke it. */
function renderZoom(initialProps: ZoomProps) {
  return renderHook(
    (props: ZoomProps) => {
      useControllable<number>("zoom", props);
      return {
        store: useAnnotatorStore("test"),
        set: useSetControllable<number>("zoom"),
        lastUser: useLastUserValue<number>("zoom"),
      };
    },
    { wrapper: AnnotatorProvider, initialProps }
  );
}

test("uncontrolled: setter updates the atom and notifies", () => {
  const onChange = vi.fn();
  const { result } = renderZoom({
    value: undefined,
    defaultValue: 1.25,
    onChange,
  });
  expect(result.current.store.get(zoomAtom)).toBe(1.25);

  act(() => result.current.set(2, USER));

  expect(result.current.store.get(zoomAtom)).toBe(2);
  expect(onChange).toHaveBeenCalledTimes(1);
  expect(onChange).toHaveBeenCalledWith(2, { source: "user" });
});

test("controlled: setter notifies but does not change the atom", () => {
  const onChange = vi.fn();
  const { result } = renderZoom({ value: 1.5, defaultValue: 1, onChange });
  expect(result.current.store.get(zoomAtom)).toBe(1.5);

  act(() => result.current.set(2, USER));

  expect(result.current.store.get(zoomAtom)).toBe(1.5);
  expect(onChange).toHaveBeenCalledTimes(1);
  expect(onChange).toHaveBeenCalledWith(2, { source: "user" });
});

test("controlled: a new value prop is written into the atom", () => {
  const { result, rerender } = renderZoom({ value: 1.5, defaultValue: 1 });
  rerender({ value: 3, defaultValue: 1 });
  expect(result.current.store.get(zoomAtom)).toBe(3);
});

test("controlled: an equal value by `equals` does not rewrite the atom", () => {
  type Props = { value: string[]; onChange?: () => void };
  const { result, rerender } = renderHook(
    (props: Props) => {
      useControllable<string[]>("selection", {
        defaultValue: [],
        equals: shallowEqualArrays,
        ...props,
      });
      return useAnnotatorStore("test");
    },
    { wrapper: AnnotatorProvider, initialProps: { value: ["a"] } as Props }
  );
  const first = result.current.get(selectedAnnotationIdsAtom);
  expect(first).toEqual(["a"]);

  rerender({ value: ["a"] });
  expect(result.current.get(selectedAnnotationIdsAtom)).toBe(first);

  rerender({ value: ["a", "b"] });
  expect(result.current.get(selectedAnnotationIdsAtom)).toEqual(["a", "b"]);
});

test("defaultValue is applied once; later defaultValue changes are ignored", () => {
  const { result, rerender } = renderZoom({
    value: undefined,
    defaultValue: 1.25,
  });
  expect(result.current.store.get(zoomAtom)).toBe(1.25);

  rerender({ value: undefined, defaultValue: 3 });
  expect(result.current.store.get(zoomAtom)).toBe(1.25);

  act(() => result.current.set(2, USER));
  rerender({ value: undefined, defaultValue: 4 });
  expect(result.current.store.get(zoomAtom)).toBe(2);
});

test("useLastUserValue records only source:'user' writes", () => {
  const { result } = renderZoom({ value: undefined, defaultValue: 1 });
  const ref = result.current.lastUser;
  expect(ref.current).toBeUndefined();

  act(() => result.current.set(2, API));
  expect(ref.current).toBeUndefined();

  act(() => result.current.set(3, USER));
  expect(ref.current).toBe(3);

  act(() => result.current.set(4, API));
  expect(ref.current).toBe(3);
});

test("useLastUserValue counts user writes, even of an equal value", () => {
  const { result } = renderZoom({ value: undefined, defaultValue: 1 });
  const ref = result.current.lastUser;
  expect(ref.version).toBe(0);

  act(() => result.current.set(2, USER));
  act(() => result.current.set(5, API));
  expect(ref.version).toBe(1);

  act(() => result.current.set(2, USER));
  expect(ref.version).toBe(2);
  expect(ref.current).toBe(2);
});

test("useLastUserValue records user writes of a controlled key too", () => {
  const { result } = renderZoom({ value: 1.5, defaultValue: 1 });
  act(() => result.current.set(2, USER));
  expect(result.current.lastUser.current).toBe(2);
  expect(result.current.store.get(zoomAtom)).toBe(1.5);
});

test("useLastUserValue returns the same object on every render", () => {
  const { result, rerender } = renderZoom({
    value: undefined,
    defaultValue: 1,
  });
  const first = result.current.lastUser;
  rerender({ value: undefined, defaultValue: 1 });
  expect(result.current.lastUser).toBe(first);
});

test("useSetControllable returns a stable function", () => {
  const { result, rerender } = renderZoom({
    value: undefined,
    defaultValue: 1,
  });
  const first = result.current.set;
  rerender({ value: 2, defaultValue: 1, onChange: () => {} });
  expect(result.current.set).toBe(first);
});

test("a null value is controlled; only undefined means uncontrolled", () => {
  const onChange = vi.fn();
  const { result } = renderHook(
    () => {
      useControllable<string | null>("activeHighlight", {
        value: null,
        defaultValue: "h1",
        onChange,
      });
      return {
        store: useAnnotatorStore("test"),
        set: useSetControllable<string | null>("activeHighlight"),
      };
    },
    { wrapper: AnnotatorProvider }
  );
  expect(result.current.store.get(activeHighlightIdAtom)).toBeNull();

  act(() => result.current.set("h2", USER));

  expect(result.current.store.get(activeHighlightIdAtom)).toBeNull();
  expect(onChange).toHaveBeenCalledWith("h2", USER);
});

test("an inline onChange is read at call time without re-registering", () => {
  const first = vi.fn();
  const second = vi.fn();
  const { result, rerender } = renderZoom({
    value: undefined,
    defaultValue: 1,
    onChange: first,
  });
  rerender({ value: undefined, defaultValue: 1, onChange: second });

  act(() => result.current.set(2, USER));

  expect(first).not.toHaveBeenCalled();
  expect(second).toHaveBeenCalledTimes(1);
});

test("a controlled key becomes uncontrolled when its value goes undefined", () => {
  const onChange = vi.fn();
  const { result, rerender } = renderZoom({
    value: 1.5,
    defaultValue: 1,
    onChange,
  });
  act(() => result.current.set(2, USER));
  expect(result.current.store.get(zoomAtom)).toBe(1.5);

  rerender({ value: undefined, defaultValue: 1, onChange });
  act(() => result.current.set(2, USER));
  expect(result.current.store.get(zoomAtom)).toBe(2);
});

test("an uncontrolled key becomes controlled when a value appears", () => {
  const onChange = vi.fn();
  const { result, rerender } = renderZoom({
    value: undefined,
    defaultValue: 1,
    onChange,
  });
  rerender({ value: 2.5, defaultValue: 1, onChange });
  expect(result.current.store.get(zoomAtom)).toBe(2.5);

  act(() => result.current.set(3, USER));
  expect(result.current.store.get(zoomAtom)).toBe(2.5);
  expect(onChange).toHaveBeenCalledWith(3, USER);
});

test("a child calling the setter while mounting sees the controlled bridge", () => {
  const onChange = vi.fn();
  let store!: AnnotatorStore;

  function Child() {
    const set = useSetControllable<number>("zoom");
    useLayoutEffect(() => set(2, API), [set]);
    useEffect(() => set(3, API), [set]);
    return null;
  }
  function Parent() {
    useControllable<number>("zoom", { value: 1.5, defaultValue: 1, onChange });
    store = useAnnotatorStore("test");
    return <Child />;
  }

  render(
    <AnnotatorProvider>
      <Parent />
    </AnnotatorProvider>
  );

  expect(store.get(zoomAtom)).toBe(1.5);
  expect(onChange.mock.calls).toEqual([
    [2, API],
    [3, API],
  ]);
});

test("the bridge is unregistered when the hook's component unmounts", () => {
  const onChange = vi.fn();
  let store!: AnnotatorStore;
  let set!: (next: number, info: ChangeInfo) => void;
  let hide!: () => void;

  function Bridge() {
    useControllable<number>("zoom", { value: 1.5, defaultValue: 1, onChange });
    return null;
  }
  function Host() {
    const [shown, setShown] = useState(true);
    hide = () => setShown(false);
    store = useAnnotatorStore("test");
    set = useSetControllable<number>("zoom");
    return shown ? <Bridge /> : null;
  }

  render(
    <AnnotatorProvider>
      <Host />
    </AnnotatorProvider>
  );
  act(() => hide());
  act(() => set(2, USER));

  expect(store.get(zoomAtom)).toBe(2);
  expect(onChange).not.toHaveBeenCalled();
});

test("initial values and the bridge survive StrictMode double invocation", () => {
  const onChange = vi.fn();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <StrictMode>
      <AnnotatorProvider>{children}</AnnotatorProvider>
    </StrictMode>
  );
  const { result } = renderHook(
    () => {
      useControllable<number>("zoom", {
        value: undefined,
        defaultValue: 1.25,
        onChange,
      });
      return {
        store: useAnnotatorStore("test"),
        set: useSetControllable<number>("zoom"),
      };
    },
    { wrapper }
  );
  expect(result.current.store.get(zoomAtom)).toBe(1.25);

  act(() => result.current.set(2, USER));

  expect(result.current.store.get(zoomAtom)).toBe(2);
  expect(onChange).toHaveBeenCalledTimes(1);
});
