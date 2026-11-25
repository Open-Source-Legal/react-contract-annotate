/**
 * A controllable stand-in for pdf.js' `getDocument`, for the jsdom tests
 * (real pdf.js only runs in the component tests). Every call records a
 * `FakeLoadingTask` the test resolves, rejects or reports progress on.
 */
import { vi } from "vitest";
import type { Mock } from "vitest";

export type FakeViewport = { width: number; height: number };

/** The page size the fake pages report at scale 1. */
export const FAKE_VIEWPORT: FakeViewport = Object.freeze({
  width: 595,
  height: 842,
});

export interface FakePage {
  pageNumber: number;
  getViewport(opts: { scale: number }): FakeViewport;
}

export interface FakeDocument {
  numPages: number;
  getPage: Mock<(pageNumber: number) => Promise<FakePage>>;
  destroy: Mock<() => Promise<void>>;
}

export function fakePage(pageNumber: number): FakePage {
  return {
    pageNumber,
    getViewport: ({ scale }) => ({
      width: FAKE_VIEWPORT.width * scale,
      height: FAKE_VIEWPORT.height * scale,
    }),
  };
}

export function fakeDocument(numPages: number): FakeDocument {
  return {
    numPages,
    getPage: vi.fn(async (pageNumber: number) => fakePage(pageNumber)),
    destroy: vi.fn(async () => {}),
  };
}

export class FakeLoadingTask {
  onProgress: ((progress: { loaded: number; total: number }) => void) | null =
    null;
  destroyed = false;
  readonly promise: Promise<FakeDocument>;
  readonly destroy = vi.fn(async () => {
    this.destroyed = true;
    // pdf.js rejects the document promise of a destroyed task.
    this.reject(new Error("Worker was destroyed"));
  });
  resolve!: (document: FakeDocument) => void;
  reject!: (error: unknown) => void;

  constructor(readonly params: Record<string, unknown>) {
    this.promise = new Promise<FakeDocument>((resolve, reject) => {
      this.resolve = resolve;
      this.reject = reject;
    });
  }

  progress(loaded: number, total: number): void {
    this.onProgress?.({ loaded, total });
  }
}

/** The tasks created since the last `reset`, in call order. */
export const fakePdfjs = {
  tasks: [] as FakeLoadingTask[],
  getDocument: vi.fn((params: Record<string, unknown>) => {
    const task = new FakeLoadingTask(params);
    fakePdfjs.tasks.push(task);
    return task;
  }),
  reset(): void {
    fakePdfjs.tasks = [];
    fakePdfjs.getDocument.mockClear();
  },
};

/** Lets every pending promise callback run. */
export function flushPromises(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
