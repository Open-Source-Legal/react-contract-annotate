/**
 * A minimal format for testing the shell: it registers a driver, mirrors a
 * chosen document status into the store, records what the shell asks of it,
 * and (optionally) completes every scroll request on the next tick.
 */
import { act } from "@testing-library/react";
import { useEffect, useLayoutEffect } from "react";
import type { Ref } from "react";

import { AnnotatorShell } from "../AnnotatorShell";
import {
  useNotifyDrawabilityChanged,
  useNotifyFitWidthChanged,
  useRegisterFormatDriver,
} from "../format";
import { useSetDocumentStatus } from "../formatHooks";
import type { ScrollRequest } from "../scroll";
import { useScrollRequest } from "../scroll";
import { useSetControllable } from "../state/controllable";
import type { ControllableKey } from "../state/controllable";
import type {
  Annotation,
  AnnotatorCommonProps,
  AnnotatorHandle,
  ChangeInfo,
  Highlight,
} from "../types";

export const FAKE_PAGE_COUNT = 3;
export const FAKE_TEXT = "fake document text";
export const FAKE_VISIBLE_RANGE: [number, number] = [0, 1];
export const FAKE_FIT_WIDTH = 1.37;

export type FakeStatus = {
  state: "loading" | "ready" | "error";
  progress: number | null;
  error: Error | null;
};
export const READY: FakeStatus = Object.freeze({
  state: "ready",
  progress: null,
  error: null,
});
export const LOADING: FakeStatus = Object.freeze({
  state: "loading",
  progress: null,
  error: null,
});

export interface FakeRecorder {
  /** Renders of the fake format component. */
  renders: number;
  /** Every distinct scroll request the format saw, in order. */
  requests: ScrollRequest[];
  /** The request in flight at the format's last render. */
  current: ScrollRequest | null;
  scrollToPageCalls: [number, ScrollBehavior][];
  findTextCalls: [string, { caseSensitive?: boolean } | undefined][];
  /** Writes a bridged value the way a format does. Usable once mounted. */
  write<T>(key: ControllableKey, next: T, info: ChangeInfo): void;
  /** Tells the shell `resolveFitWidth()` may differ. Usable once mounted. */
  notifyFitWidthChanged(): void;
  /** When false, `canDraw` answers false for everything. Default true. */
  drawable: boolean;
  /** Tells the shell `canDraw` may answer differently. Usable once mounted. */
  notifyDrawabilityChanged(): void;
}

export function createRecorder(): FakeRecorder {
  return {
    renders: 0,
    requests: [],
    current: null,
    scrollToPageCalls: [],
    findTextCalls: [],
    write() {
      throw new Error("the fake format is not mounted");
    },
    notifyFitWidthChanged() {
      throw new Error("the fake format is not mounted");
    },
    drawable: true,
    notifyDrawabilityChanged() {
      throw new Error("the fake format is not mounted");
    },
  };
}

export interface FakeFormatProps {
  recorder: FakeRecorder;
  /** Default `READY`. */
  status?: FakeStatus;
  /** Complete each scroll request with `true` on the next tick (default). */
  autoComplete?: boolean;
  /** What `resolveFitWidth()` returns. Default `FAKE_FIT_WIDTH`. */
  fitWidth?: number | null;
}

export function FakeFormat({
  recorder,
  status = READY,
  autoComplete = true,
  fitWidth = FAKE_FIT_WIDTH,
}: FakeFormatProps) {
  recorder.renders += 1;

  const setSelection = useSetControllable<string[]>("selection");
  const setZoom = useSetControllable<number>("zoom");
  const setActiveHighlight = useSetControllable<string | null>(
    "activeHighlight"
  );
  const notifyFitWidthChanged = useNotifyFitWidthChanged();
  const notifyDrawabilityChanged = useNotifyDrawabilityChanged();
  useLayoutEffect(() => {
    const setters = {
      selection: setSelection,
      zoom: setZoom,
      activeHighlight: setActiveHighlight,
    } as Record<ControllableKey, (next: unknown, info: ChangeInfo) => void>;
    recorder.write = (key, next, info) => setters[key](next, info);
    recorder.notifyFitWidthChanged = notifyFitWidthChanged;
    recorder.notifyDrawabilityChanged = notifyDrawabilityChanged;
  }, [
    recorder,
    setSelection,
    setZoom,
    setActiveHighlight,
    notifyFitWidthChanged,
    notifyDrawabilityChanged,
  ]);

  const setStatus = useSetDocumentStatus();
  useLayoutEffect(() => setStatus(status), [setStatus, status]);

  // A new driver object on every render, as a careless format would pass.
  useRegisterFormatDriver({
    kind: "span",
    getPageCount: () => FAKE_PAGE_COUNT,
    getVisiblePageRange: () => FAKE_VISIBLE_RANGE,
    getText: () => FAKE_TEXT,
    findText: (query, opts) => {
      recorder.findTextCalls.push([query, opts]);
      return [
        {
          id: `find-${query}`,
          target: { kind: "span", start: 0, end: query.length },
        },
      ];
    },
    scrollToPage: (pageIndex, behavior) => {
      recorder.scrollToPageCalls.push([pageIndex, behavior]);
      return pageIndex >= 0 && pageIndex < FAKE_PAGE_COUNT;
    },
    resolveFitWidth: () => fitWidth,
    canDraw: (target) =>
      recorder.drawable &&
      target.id.startsWith(target.kind === "annotation" ? "a" : "h"),
  });

  const { request, complete } = useScrollRequest();
  recorder.current = request;
  useEffect(() => {
    if (!request) return;
    if (!recorder.requests.some((seen) => seen.seq === request.seq)) {
      recorder.requests.push(request);
    }
    if (!autoComplete) return;
    const timer = setTimeout(() => complete(request.seq, true), 0);
    return () => clearTimeout(timer);
  }, [recorder, request, complete, autoComplete]);

  return <div data-fake-format="" />;
}

/** The shell with the fake format inside. */
export function FakeAnnotator({
  common,
  fake,
  handleRef,
}: {
  common: AnnotatorCommonProps;
  fake: FakeFormatProps;
  handleRef: Ref<AnnotatorHandle>;
}) {
  return (
    <AnnotatorShell common={common} handleRef={handleRef}>
      <FakeFormat {...fake} />
    </AnnotatorShell>
  );
}

const LABEL = Object.freeze({ id: "l1", text: "Clause" });

/** A span annotation with a fixed label. */
export function annotation(id: string): Annotation {
  return { id, annotationLabel: LABEL, json: { start: 0, end: 4 } };
}

/** A span highlight. */
export function highlight(id: string): Highlight {
  return { id, target: { kind: "span", start: 0, end: 4 } };
}

/**
 * Calls `start` inside `act` (so the renders and effects it causes are
 * flushed, letting the fake see and complete a scroll request), then awaits
 * the promise it returned.
 */
export async function settle(start: () => Promise<boolean>): Promise<boolean> {
  let promise!: Promise<boolean>;
  act(() => {
    promise = start();
  });
  let result!: boolean;
  await act(async () => {
    result = await promise;
  });
  return result;
}
