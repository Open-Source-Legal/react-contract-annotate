/**
 * Opening links: link annotations (`linkUrl`) and the links embedded in a
 * document. Both go to the host's `onOpenLink` when it is supplied;
 * otherwise an `http:` / `https:` URL opens in a new tab with `noopener` and
 * anything else is ignored. `isUrlAnnotation` is ported from OpenContracts'
 * `annotator/utils/urlAnnotation.ts` (98286cabf).
 */
import { useCallback } from "react";

import { eventCallbacks } from "./callbacks";
import { useAnnotatorStore } from "./state/AnnotatorProvider";
import type { Annotation } from "./types";

/** Schemes opened without an `onOpenLink`. */
const OPENABLE_PROTOCOLS: readonly string[] = Object.freeze(["http:", "https:"]);

/**
 * Whether an annotation should behave as a clickable hyperlink: true for ANY
 * annotation with a non-empty `linkUrl`. An annotation with a missing URL
 * falls back to normal selection behaviour.
 */
export function isUrlAnnotation(annotation: {
  linkUrl?: string | null;
}): boolean {
  return (
    typeof annotation.linkUrl === "string" &&
    annotation.linkUrl.trim().length > 0
  );
}

/** True for an absolute `http:` / `https:` URL. */
function isOpenableUrl(url: string): boolean {
  try {
    return OPENABLE_PROTOCOLS.includes(new URL(url).protocol);
  } catch {
    return false; // relative or malformed
  }
}

/**
 * For formats. Returns a stable function that opens `url` on behalf of an
 * annotation (`source`, the host's own object) or of a link embedded in the
 * document (`"native"`). The host's `onOpenLink` is read when it is called.
 */
export function useOpenLink(): (
  url: string,
  source: Annotation | "native"
) => void {
  const store = useAnnotatorStore("useOpenLink");
  return useCallback(
    (url: string, source: Annotation | "native") => {
      const { onOpenLink } = eventCallbacks(store);
      if (onOpenLink) {
        onOpenLink(url, source);
        return;
      }
      if (isOpenableUrl(url)) window.open(url, "_blank", "noopener,noreferrer");
    },
    [store]
  );
}
