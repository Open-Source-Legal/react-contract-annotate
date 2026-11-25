/**
 * The list beside the viewer: the document's annotations under their labels,
 * and its relationships. A row jumps to its annotation; a label's checkbox
 * filters the viewer (`visibleLabelIds`); a relationship shows its two ends.
 */
import type {
  Annotation,
  AnnotationLabel,
  Relation,
} from "@os-legal/react-contract-annotate";
import { useMemo } from "react";

import { preview } from "./text";

interface SidebarProps {
  annotations: Annotation[];
  relations: Relation[];
  selectedIds: string[];
  hiddenLabelIds: ReadonlySet<string>;
  onToggleLabel(labelId: string): void;
  showStructural: boolean;
  onToggleStructural(): void;
  onJump(annotationId: string): void;
  selectedRelationId: string | null;
  onSelectRelation(relation: Relation): void;
}

interface LabelGroup {
  label: AnnotationLabel;
  annotations: Annotation[];
}

/** The annotations under their labels, labels in order of first use. */
function groupByLabel(annotations: Annotation[]): LabelGroup[] {
  const groups = new Map<string, LabelGroup>();
  for (const annotation of annotations) {
    const { annotationLabel: label } = annotation;
    const group = groups.get(label.id) ?? { label, annotations: [] };
    group.annotations.push(annotation);
    groups.set(label.id, group);
  }
  return [...groups.values()];
}

export function Sidebar({
  annotations,
  relations,
  selectedIds,
  hiddenLabelIds,
  onToggleLabel,
  showStructural,
  onToggleStructural,
  onJump,
  selectedRelationId,
  onSelectRelation,
}: SidebarProps) {
  const groups = useMemo(
    () => groupByLabel(annotations.filter((a) => !a.structural)),
    [annotations]
  );
  const structuralCount = useMemo(
    () => annotations.filter((a) => a.structural).length,
    [annotations]
  );
  const textById = useMemo(
    () => new Map(annotations.map((a) => [a.id, a.rawText])),
    [annotations]
  );

  return (
    <aside className="sidebar" aria-label="Annotations">
      <h2>Annotations</h2>
      {groups.map(({ label, annotations: items }) => (
        <section
          key={label.id}
          className="label-group"
          style={{ "--label": label.color } as React.CSSProperties}
        >
          <label className="label-head" title={label.description}>
            <input
              type="checkbox"
              checked={!hiddenLabelIds.has(label.id)}
              onChange={() => onToggleLabel(label.id)}
            />
            <span className="label-name">{label.text}</span>
            <span className="count">{items.length}</span>
          </label>
          <ul>
            {items.map((annotation) => (
              <li key={annotation.id}>
                <button
                  type="button"
                  className="note"
                  aria-current={selectedIds.includes(annotation.id)}
                  onClick={() => onJump(annotation.id)}
                >
                  {preview(annotation.rawText)}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
      <label className="label-head structure">
        <input
          type="checkbox"
          checked={showStructural}
          onChange={onToggleStructural}
        />
        <span className="label-name">Document structure</span>
        <span className="count">{structuralCount}</span>
      </label>

      <h2>Relationships</h2>
      <ul className="relations">
        {relations.map((relation) => (
          <li key={relation.id}>
            <button
              type="button"
              className="note"
              aria-current={relation.id === selectedRelationId}
              onClick={() => onSelectRelation(relation)}
            >
              <strong>{relation.label.text}</strong>
              {preview(textById.get(relation.sourceIds[0]))}
            </button>
          </li>
        ))}
      </ul>
    </aside>
  );
}
