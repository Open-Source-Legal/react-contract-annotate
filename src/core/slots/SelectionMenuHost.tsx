/**
 * Renders the host's `renderSelectionMenu` slot for the pending selection. It
 * renders nothing without a slot or without a pending selection.
 */
import { createPortal } from "react-dom";
import type { CSSProperties, SyntheticEvent } from "react";

import { THEME_DEFAULTS } from "../constants";
import { useRootElement } from "../formatHooks";
import { clampMenuPosition } from "../geometry/layout";
import { usePendingActions, usePendingSelection } from "../pending";
import type { AnnotatorCommonProps } from "../types";

const Z_MENU_PROPERTY = "--rca-z-menu";

/**
 * The menu is portalled to the body of the root's document, outside the root
 * that defines the theming custom properties, so it cannot inherit
 * `--rca-z-menu`: the root's resolved value (the default, or the host's
 * override) is copied onto it.
 */
function resolveZMenu(root: HTMLElement): string {
  const resolved = getComputedStyle(root)
    .getPropertyValue(Z_MENU_PROPERTY)
    .trim();
  return resolved || THEME_DEFAULTS.zMenu;
}

/** The host's menu is not part of the document: pressing in it selects nothing. */
function stopPropagation(event: SyntheticEvent): void {
  event.stopPropagation();
}

export function SelectionMenuHost({
  render,
}: {
  render: AnnotatorCommonProps["renderSelectionMenu"];
}) {
  const pending = usePendingSelection();
  const actions = usePendingActions();
  const root = useRootElement();
  if (!pending || !render || !root) return null;

  const { x, y } = clampMenuPosition(pending.anchor.x, pending.anchor.y);
  const style = {
    position: "fixed",
    left: x,
    top: y,
    [Z_MENU_PROPERTY]: resolveZMenu(root),
    zIndex: `var(${Z_MENU_PROPERTY}, ${THEME_DEFAULTS.zMenu})`,
  } as CSSProperties;

  return createPortal(
    <div
      data-rca-selection-menu=""
      style={style}
      onMouseDown={stopPropagation}
      onTouchStart={stopPropagation}
    >
      {render({ pending, anchor: pending.anchor, ...actions })}
    </div>,
    root.ownerDocument.body
  );
}
