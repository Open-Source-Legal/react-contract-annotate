/**
 * What every format's harness does the same way: expose the handle and a
 * log of every callback on `window` (see `helpers/harness.ts`), turn created
 * drafts into annotations as a host would, and render a minimal selection
 * menu.
 */
import { useCallback } from "react";

import type {
  Annotation,
  AnnotationDraft,
  AnnotationLabel,
  AnnotatorCommonProps,
  AnnotatorHandle,
  SelectionMenuContext,
} from "../../src/core/index";
import type { HarnessEvent } from "../helpers/harness";

export const DEFAULT_NAME = "default";

/** Every callback prop of an annotator, each logged as it fires. */
export const CALLBACKS = [
  "onSelectionChange",
  "onZoomChange",
  "onActiveHighlightChange",
  "onCreateAnnotation",
  "onTextSelect",
  "onAnnotationClick",
  "onAnnotationHover",
  "onOpenLink",
  "onDocumentLoad",
  "onError",
  "onVisiblePagesChange",
] as const satisfies readonly (keyof AnnotatorCommonProps)[];

export type CallbackName = (typeof CALLBACKS)[number];

/** The log of the harness `name`, created on first use. */
export function eventLog(name: string): HarnessEvent[] {
  const logs = (window.__rcaEventLogs ??= {});
  const log = (logs[name] ??= []);
  if (name === DEFAULT_NAME) window.__rcaEvents = log;
  return log;
}

/**
 * Every callback, logging its call to `log` before calling the one in
 * `props` (then `afterEach`); those in `omit` are left out.
 */
export function loggedCallbacks(
  log: HarnessEvent[],
  props: Partial<AnnotatorCommonProps>,
  omit: readonly CallbackName[],
  afterEach?: () => void
): Pick<AnnotatorCommonProps, CallbackName> {
  const callbacks: Partial<Record<CallbackName, unknown>> = {};
  for (const callback of CALLBACKS) {
    if (omit.includes(callback)) {
      callbacks[callback] = undefined;
      continue;
    }
    const own = props[callback] as
      ((...args: unknown[]) => unknown) | undefined;
    callbacks[callback] = (...args: unknown[]) => {
      log.push([callback, ...args]);
      const result = own?.(...args);
      afterEach?.();
      return result;
    };
  }
  return callbacks as Pick<AnnotatorCommonProps, CallbackName>;
}

/** A ref callback that publishes the handle of the harness `name`. */
export function useHandleSetter(
  name: string
): (handle: AnnotatorHandle | null) => void {
  return useCallback(
    (handle: AnnotatorHandle | null) => {
      (window.__rcaHandles ??= {})[name] = handle;
      if (name === DEFAULT_NAME) window.__rca = handle;
    },
    [name]
  );
}

/** The label of a created annotation whose draft has none. */
const CREATED_LABEL: AnnotationLabel = Object.freeze({
  id: "l-created",
  text: "Created",
});

/** The annotation a host makes of the `n`th created draft. */
export function createdAnnotation(
  draft: AnnotationDraft,
  n: number
): Annotation {
  return {
    id: `created-${n}`,
    annotationLabel: draft.annotationLabel ?? CREATED_LABEL,
    rawText: draft.rawText,
    page: draft.page,
    json: draft.json,
  };
}

/**
 * A `renderSelectionMenu`: `[data-harness-menu]` with an Apply button,
 * `[data-harness-apply]`, that commits the pending selection.
 */
export function renderMenu(ctx: SelectionMenuContext) {
  return (
    <div data-harness-menu="">
      <button type="button" data-harness-apply="" onClick={() => ctx.commit()}>
        Apply
      </button>
    </div>
  );
}
