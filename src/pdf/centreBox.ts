/**
 * The last step of a scroll request for an annotation: bring its box into
 * view and report when the scroll has landed. As in OpenContracts
 * (`scrollIntoView({ block: "center" })`, `renderers/pdf/PDFPage.tsx`,
 * 98286cabf), the box is centred vertically and moved horizontally only as
 * far as it takes to bring it into view ("nearest").
 *
 * The instance's own scroll container (the root) is scrolled by computed
 * offset, so host ancestors do not move; when the root does not scroll (the
 * viewport's window fallback), `scrollIntoView` is used instead.
 */
import { SCROLL_LANDED_TOLERANCE_PX, SCROLL_SETTLE_FRAMES } from "./constants";

/**
 * How far to scroll along one axis to bring `[start, end]` into
 * `[viewStart, viewEnd]` with the least movement (CSSOM's "nearest"
 * alignment): 0 when it is already in view, or when it covers the whole view.
 */
export function nearestScrollDelta(
  start: number,
  end: number,
  viewStart: number,
  viewEnd: number
): number {
  const fits = end - start <= viewEnd - viewStart;
  const startOutside = start < viewStart;
  const endOutside = end > viewEnd;
  if (startOutside === endOutside) return 0; // in view, or covering it
  // Align the start when the box fits and sticks out before the view, or is
  // too big and sticks out after it; otherwise align the end.
  return startOutside === fits ? start - viewStart : end - viewEnd;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

/** What `whenLanded` watches: a scroll position and where `scrollend` fires. */
type Scroller = {
  position(): [left: number, top: number];
  events: EventTarget;
};

function elementScroller(element: HTMLElement): Scroller {
  return {
    position: () => [element.scrollLeft, element.scrollTop],
    events: element,
  };
}

const windowScroller = (): Scroller => ({
  position: () => [window.scrollX, window.scrollY],
  events: window,
});

/**
 * Calls `onLanded` once the scroll has landed: the position reached `target`
 * (when known), `scrollend` fired, or the position held still for
 * `SCROLL_SETTLE_FRAMES` frames, whichever comes first. Returns a function
 * that stops waiting without calling it.
 */
function whenLanded(
  scroller: Scroller,
  target: [number, number] | null,
  onLanded: () => void
): () => void {
  const atTarget = ([left, top]: [number, number]) =>
    target !== null &&
    Math.abs(left - target[0]) <= SCROLL_LANDED_TOLERANCE_PX &&
    Math.abs(top - target[1]) <= SCROLL_LANDED_TOLERANCE_PX;

  let last = scroller.position();
  if (atTarget(last)) {
    onLanded(); // an instant scroll lands at once
    return () => {};
  }

  let frame = 0;
  let stillFrames = 0;
  const stop = () => {
    cancelAnimationFrame(frame);
    scroller.events.removeEventListener("scrollend", land);
  };
  function land() {
    stop();
    onLanded();
  }
  const watch = () => {
    const next = scroller.position();
    if (atTarget(next)) return land();
    stillFrames =
      next[0] === last[0] && next[1] === last[1] ? stillFrames + 1 : 0;
    last = next;
    if (stillFrames >= SCROLL_SETTLE_FRAMES) return land();
    frame = requestAnimationFrame(watch);
  };
  scroller.events.addEventListener("scrollend", land);
  frame = requestAnimationFrame(watch);
  return stop;
}

/**
 * Scrolls `box` into the root's view with `behavior` (centred vertically,
 * "nearest" horizontally) and calls `onLanded` once the scroll has landed.
 * Returns a function that stops waiting for it.
 */
export function centreBox(
  root: HTMLElement,
  box: HTMLElement,
  behavior: ScrollBehavior,
  onLanded: () => void
): () => void {
  if (root.scrollHeight <= root.clientHeight) {
    box.scrollIntoView({ behavior, block: "center", inline: "nearest" });
    if (behavior === "instant") {
      onLanded();
      return () => {};
    }
    return whenLanded(windowScroller(), null, onLanded);
  }

  const view = root.getBoundingClientRect();
  const rect = box.getBoundingClientRect();
  const viewTop = view.top + root.clientTop;
  const viewLeft = view.left + root.clientLeft;
  const top = clamp(
    root.scrollTop +
      (rect.top + rect.height / 2) -
      (viewTop + root.clientHeight / 2),
    0,
    root.scrollHeight - root.clientHeight
  );
  const left = clamp(
    root.scrollLeft +
      nearestScrollDelta(
        rect.left,
        rect.right,
        viewLeft,
        viewLeft + root.clientWidth
      ),
    0,
    root.scrollWidth - root.clientWidth
  );
  root.scrollTo({ top, left, behavior });
  return whenLanded(elementScroller(root), [left, top], onLanded);
}
