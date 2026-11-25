/**
 * The host's `annotationActions` as buttons, for a format to put in an
 * annotation's label chip (`LabelChip`'s `actions`). The library draws the
 * button and reports the click; what an action does is the host's.
 */
import type { ReactNode } from "react";

import { ANNOTATION_ACTION_BUTTON } from "./constants";
import { useAnnotationActions } from "./formatHooks";
import { styled } from "./styled";
import type { Annotation } from "./types";

const ActionButton = styled.button`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  min-width: ${ANNOTATION_ACTION_BUTTON.size};
  height: ${ANNOTATION_ACTION_BUTTON.size};
  margin: 0 0 0 ${ANNOTATION_ACTION_BUTTON.gap};
  padding: ${ANNOTATION_ACTION_BUTTON.padding};
  border: 0;
  border-radius: ${ANNOTATION_ACTION_BUTTON.radius};
  background: transparent;
  color: inherit;
  font: inherit;
  line-height: 1;
  cursor: pointer;

  &:hover:not(:disabled),
  &:focus-visible {
    background: color-mix(
      in srgb,
      currentColor ${ANNOTATION_ACTION_BUTTON.hoverTintPercent}%,
      transparent
    );
  }

  &:focus-visible {
    outline: 2px solid currentColor;
    outline-offset: 1px;
  }

  &:disabled {
    opacity: ${ANNOTATION_ACTION_BUTTON.disabledOpacity};
    cursor: default;
  }
`;

/**
 * The buttons of the actions offered for `annotation` (the host's own
 * object), in the host's order; null when there is none, so a chip can tell
 * it has nothing to show beside its label.
 */
export function useAnnotationActionButtons(annotation: Annotation): ReactNode {
  const actions = useAnnotationActions().filter(
    (action) => action.isVisible?.(annotation) ?? true
  );
  if (actions.length === 0) return null;
  return actions.map((action) => (
    <ActionButton
      key={action.id}
      type="button"
      data-rca-annotation-action={action.id}
      aria-label={action.label}
      title={action.label}
      disabled={action.isDisabled?.(annotation) ?? false}
      onClick={(event) => action.onClick(annotation, event)}
    >
      {action.icon ?? action.label}
    </ActionButton>
  ));
}
