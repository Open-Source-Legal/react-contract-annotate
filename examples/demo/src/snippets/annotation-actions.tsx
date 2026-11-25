/** README sample: buttons beside annotation labels. Kept here so that it is type-checked. */
import { DocumentAnnotator } from "@os-legal/react-contract-annotate";
import type {
  Annotation,
  AnnotationAction,
  DocumentInput,
} from "@os-legal/react-contract-annotate";
import { useMemo } from "react";

export function Reviewable({
  document,
  annotations,
  onEdit,
  onDelete,
}: {
  document: DocumentInput;
  annotations: Annotation[];
  onEdit(annotation: Annotation): void;
  onDelete(id: string): void;
}) {
  // The same array while the actions are the same.
  const actions = useMemo<AnnotationAction[]>(
    () => [
      {
        id: "edit",
        label: "Edit",
        icon: <span aria-hidden="true">✎</span>,
        onClick: (annotation) => onEdit(annotation),
      },
      {
        id: "delete",
        label: "Delete",
        icon: <span aria-hidden="true">✕</span>,
        onClick: (annotation) => onDelete(annotation.id),
        // Not offered for the document's own structure.
        isVisible: (annotation) => !annotation.structural,
      },
    ],
    [onEdit, onDelete]
  );
  return (
    <DocumentAnnotator
      document={document}
      annotations={annotations}
      annotationActions={actions}
    />
  );
}
