/**
 * What the viewer shows next to a finished text selection: the demo's own
 * menu, rendered through the `renderSelectionMenu` slot. The viewer places it
 * and keeps the selection painted; the menu decides what happens to it.
 */
import type {
  AnnotationLabel,
  SelectionMenuContext,
} from "@os-legal/react-contract-annotate";

interface SelectionMenuProps extends SelectionMenuContext {
  labels: AnnotationLabel[];
}

export function SelectionMenu({
  labels,
  commit,
  clear,
  copyText,
}: SelectionMenuProps) {
  return (
    <div className="selection-menu" role="menu" aria-label="Annotate selection">
      <p>Label this passage</p>
      {labels.map((label) => (
        <button
          key={label.id}
          type="button"
          role="menuitem"
          className="selection-menu-label"
          onClick={() => commit(label)}
        >
          <span className="swatch" style={{ background: label.color }} />
          {label.text}
        </button>
      ))}
      <div className="selection-menu-actions">
        <button
          type="button"
          role="menuitem"
          onClick={() => void copyText().then(clear)}
        >
          Copy text
        </button>
        <button type="button" role="menuitem" onClick={clear}>
          Cancel
        </button>
      </div>
    </div>
  );
}
