/**
 * Test-side access to what `wrappers/PdfHarness.tsx` exposes on `window`: the
 * annotator handle and the log of every callback it fired. A harness is
 * addressed by its `name` (default `DEFAULT_HARNESS`).
 */
import type { Locator, Page } from "@playwright/test";

import type { AnnotatorHandle } from "../../src/core/index";

/** One callback invocation: its prop name, then its arguments. */
export type HarnessEvent = [name: string, ...args: unknown[]];

declare global {
  interface Window {
    /** Handle of the harness named `DEFAULT_HARNESS`. */
    __rca?: AnnotatorHandle | null;
    /** Event log of the harness named `DEFAULT_HARNESS`. */
    __rcaEvents?: HarnessEvent[];
    /** Handles by harness name. */
    __rcaHandles?: Record<string, AnnotatorHandle | null>;
    /** Event logs by harness name. */
    __rcaEventLogs?: Record<string, HarnessEvent[]>;
  }
}

export const DEFAULT_HARNESS = "default";

/** The annotator root (its scroll container) inside the harness. */
export function annotatorRoot(page: Page, name = DEFAULT_HARNESS): Locator {
  return page.locator(`[data-harness="${name}"] [data-rca-root]`);
}

type HandleMethod = {
  [K in keyof AnnotatorHandle]: AnnotatorHandle[K] extends (
    ...args: never[]
  ) => unknown
    ? K
    : never;
}[keyof AnnotatorHandle];

/** Calls a handle method in the page and returns its (awaited) result. */
export function callHandle<K extends HandleMethod>(
  page: Page,
  method: K,
  args: Parameters<AnnotatorHandle[K]>,
  name = DEFAULT_HARNESS
): Promise<Awaited<ReturnType<AnnotatorHandle[K]>>> {
  return page.evaluate(
    ([harness, m, a]) => {
      const handle = window.__rcaHandles?.[harness];
      if (!handle) throw new Error(`harness "${harness}" has no handle`);
      const fn = handle[m] as (...args: unknown[]) => unknown;
      return fn.apply(handle, a as unknown[]);
    },
    [name, method, args] as const
  ) as Promise<Awaited<ReturnType<AnnotatorHandle[K]>>>;
}

/**
 * The callbacks the harness has seen, optionally only those named `event`,
 * made JSON-safe in the page: an `Error` becomes `{ error: message }`, a
 * function `"[function]"` and an event object `{ type }`.
 */
export function harnessEvents(
  page: Page,
  event?: string,
  name = DEFAULT_HARNESS
): Promise<HarnessEvent[]> {
  return page.evaluate(
    ([harness, only]) => {
      const toJson = (value: unknown): unknown => {
        if (value instanceof Error) return { error: value.message };
        if (typeof value === "function") return "[function]";
        if (
          value instanceof Event ||
          (typeof value === "object" &&
            value !== null &&
            "nativeEvent" in value)
        ) {
          return { type: (value as Event).type };
        }
        return JSON.parse(
          JSON.stringify(value ?? null, (_key, v) =>
            typeof v === "function" ? "[function]" : v
          )
        );
      };
      return (window.__rcaEventLogs?.[harness] ?? [])
        .filter(([eventName]) => only === null || eventName === only)
        .map(([eventName, ...args]) => [eventName, ...args.map(toJson)]);
    },
    [name, event ?? null] as const
  ) as Promise<HarnessEvent[]>;
}

/** Resolves once the harness' annotator has fired `onDocumentLoad`. */
export async function waitForDocumentLoad(
  page: Page,
  name = DEFAULT_HARNESS
): Promise<void> {
  await page.waitForFunction(
    (harness) =>
      (window.__rcaEventLogs?.[harness] ?? []).some(
        ([eventName]) => eventName === "onDocumentLoad"
      ),
    name
  );
}
