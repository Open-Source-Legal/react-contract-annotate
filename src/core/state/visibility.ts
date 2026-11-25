/**
 * Which annotations are drawn, given the display settings and selection. The
 * single source of truth for every renderer and list, ported unchanged from
 * OpenContracts' `useVisibleAnnotations` (98286cabf): selected annotations and
 * the endpoints of selected relations are always shown; then
 * `showSelectedOnly`, `showStructural` and the `visibleLabelIds` filter apply.
 */
import { useAtomValue } from "jotai";
import { useMemo } from "react";

import type { InternalAnnotation } from "../normalize";
import type { Relation } from "../types";
import { useAnnotatorStore } from "./AnnotatorProvider";
import {
  annotationsAtom,
  displaySettingsAtom,
  relationsAtom,
  selectedAnnotationIdsAtom,
  selectedRelationIdsAtom,
} from "./atoms";
import type { DisplaySettings } from "./atoms";

export interface VisibilityInput {
  annotations: readonly InternalAnnotation[];
  relations: readonly Relation[];
  selectedAnnotationIds: readonly string[];
  selectedRelationIds: readonly string[];
  settings: DisplaySettings;
}

export function selectVisibleAnnotations({
  annotations,
  relations,
  selectedAnnotationIds,
  selectedRelationIds,
  settings,
}: VisibilityInput): InternalAnnotation[] {
  const {
    showStructural,
    showStructuralRelationships,
    showSelectedOnly,
    visibleLabelIds,
  } = settings;

  const selectedIds = new Set(selectedAnnotationIds);
  const selectedRelationIdSet = new Set(selectedRelationIds);
  const selectedRelations = relations.filter((rel) =>
    selectedRelationIdSet.has(rel.id)
  );

  /* ---- ①  IDs that must be visible whatever other filters say ---- */
  const forcedBySelectedRelationIds = new Set<string>(
    selectedRelations.flatMap((rel) => [...rel.sourceIds, ...rel.targetIds])
  );

  const forcedByRelationships = new Set<string>();
  if (showStructuralRelationships) {
    relations.forEach((rel) => {
      rel.sourceIds.forEach((id) => forcedByRelationships.add(id));
      rel.targetIds.forEach((id) => forcedByRelationships.add(id));
    });
  }

  /* always show the annotations that are currently selected              */
  const forcedIds = new Set(selectedIds);

  // Explicit relation selection always wins; not gated on showStructural
  // (unlike forcedByRelationships).
  forcedBySelectedRelationIds.forEach((id) => forcedIds.add(id));

  if (showStructural) {
    forcedByRelationships.forEach((id) => forcedIds.add(id));
  }

  /* ---- ②  Helper for label filter ------------------------------------ */
  const labelFilterActive =
    visibleLabelIds && visibleLabelIds.length > 0
      ? new Set(visibleLabelIds)
      : null;

  /* ---- ③  Final predicate -------------------------------------------- */
  return annotations.filter((annot) => {
    /* forced: always keep                                               */
    if (forcedIds.has(annot.id)) {
      return true;
    }

    /* showSelectedOnly: only selected annotations and their connections */
    if (showSelectedOnly) {
      const isConnected = forcedBySelectedRelationIds.has(annot.id);
      if (!selectedIds.has(annot.id) && !isConnected) {
        return false;
      }
    }

    /* structural filter: hide structural annotations unless shown       */
    if (annot.structural && !showStructural) {
      return false;
    }

    /* label filter: applies to both structural and non-structural       */
    if (labelFilterActive && !labelFilterActive.has(annot.annotationLabel.id)) {
      return false;
    }

    return true;
  });
}

/** The visible annotations of the instance under the nearest provider. */
export function useVisibleAnnotations(): InternalAnnotation[] {
  const store = useAnnotatorStore("useVisibleAnnotations");
  const annotations = useAtomValue(annotationsAtom, { store });
  const relations = useAtomValue(relationsAtom, { store });
  const selectedAnnotationIds = useAtomValue(selectedAnnotationIdsAtom, {
    store,
  });
  const selectedRelationIds = useAtomValue(selectedRelationIdsAtom, { store });
  const settings = useAtomValue(displaySettingsAtom, { store });

  return useMemo(
    () =>
      selectVisibleAnnotations({
        annotations,
        relations,
        selectedAnnotationIds,
        selectedRelationIds,
        settings,
      }),
    [
      annotations,
      relations,
      selectedAnnotationIds,
      selectedRelationIds,
      settings,
    ]
  );
}
