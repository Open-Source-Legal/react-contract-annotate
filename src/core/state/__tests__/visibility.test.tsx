/**
 * Regression net for the visibility filter, ported from OpenContracts'
 * useVisibleAnnotations tests (98286cabf). Every branch is pinned: forced by
 * selection, forced by a selected relation, the structural toggle, the label
 * filter and showSelectedOnly. The upstream cases are kept as written, with
 * the inputs passed to the pure `selectVisibleAnnotations` instead of through
 * mocked hooks, followed by cases for the library's own additions.
 */
import { act, renderHook } from "@testing-library/react";
import { useStore } from "jotai";

import { normalizeAnnotation } from "../../normalize";
import type { InternalAnnotation } from "../../normalize";
import type { Annotation, AnnotationLabel, Relation } from "../../types";
import { AnnotatorProvider } from "../AnnotatorProvider";
import {
  annotationsAtom,
  DEFAULT_DISPLAY_SETTINGS,
  displaySettingsAtom,
  relationsAtom,
  selectedAnnotationIdsAtom,
  selectedRelationIdsAtom,
} from "../atoms";
import type { DisplaySettings } from "../atoms";
import { selectVisibleAnnotations, useVisibleAnnotations } from "../visibility";

const labelA: AnnotationLabel = {
  id: "label-a",
  text: "Label A",
  color: "#ff0000",
};
const labelB: AnnotationLabel = {
  id: "label-b",
  text: "Label B",
  color: "#00ff00",
};

/** Minimal valid v1 token JSON. */
const minimalJson = {
  0: {
    bounds: { top: 0, bottom: 10, left: 0, right: 10 },
    rawText: "",
    tokensJsons: [],
  },
};

function makeAnnot(opts: {
  id: string;
  label?: AnnotationLabel;
  structural?: boolean;
}): InternalAnnotation {
  const annotation: Annotation = {
    id: opts.id,
    annotationLabel: opts.label ?? labelA,
    rawText: "raw",
    page: 0,
    json: minimalJson,
    structural: opts.structural ?? false,
  };
  return normalizeAnnotation(annotation);
}

function makeRelation(
  id: string,
  sourceIds: string[],
  targetIds: string[]
): Relation {
  return { id, label: labelA, sourceIds, targetIds };
}

type State = {
  annotations: InternalAnnotation[];
  relations: Relation[];
  settings: Partial<DisplaySettings>;
  selectedAnnotationIds: string[];
  selectedRelationIds: string[];
};

/**
 * Runs the filter and returns the visible ids. Upstream's fixtures default to
 * `showStructural: true` (the library default is false), so that is restored
 * here to keep the ported cases meaning what they meant upstream.
 */
function visibleIds(state: Partial<State>): string[] {
  const {
    annotations = [],
    relations = [],
    settings = {},
    selectedAnnotationIds = [],
    selectedRelationIds = [],
  } = state;
  return selectVisibleAnnotations({
    annotations,
    relations,
    selectedAnnotationIds,
    selectedRelationIds,
    settings: { ...DEFAULT_DISPLAY_SETTINGS, showStructural: true, ...settings },
  }).map((a) => a.id);
}

describe("selectVisibleAnnotations", () => {
  test("returns every annotation when no filters are active", () => {
    const a = makeAnnot({ id: "a" });
    const b = makeAnnot({ id: "b" });
    expect(visibleIds({ annotations: [a, b] })).toEqual(["a", "b"]);
  });

  describe("structural filter", () => {
    test("hides structural annotations when showStructural is false", () => {
      const regular = makeAnnot({ id: "reg" });
      const structural = makeAnnot({ id: "struct", structural: true });
      expect(
        visibleIds({
          annotations: [regular, structural],
          settings: { showStructural: false },
        })
      ).toEqual(["reg"]);
    });

    test("keeps structural annotations when showStructural is true", () => {
      const regular = makeAnnot({ id: "reg" });
      const structural = makeAnnot({ id: "struct", structural: true });
      expect(visibleIds({ annotations: [regular, structural] })).toEqual([
        "reg",
        "struct",
      ]);
    });
  });

  describe("label filter (visibleLabelIds)", () => {
    test("keeps only annotations whose label is in visibleLabelIds", () => {
      const withA = makeAnnot({ id: "a-annot", label: labelA });
      const withB = makeAnnot({ id: "b-annot", label: labelB });
      expect(
        visibleIds({
          annotations: [withA, withB],
          settings: { visibleLabelIds: [labelA.id] },
        })
      ).toEqual(["a-annot"]);
    });

    test("treats an empty visibleLabelIds array as 'no filter'", () => {
      const withA = makeAnnot({ id: "a-annot", label: labelA });
      const withB = makeAnnot({ id: "b-annot", label: labelB });
      expect(
        visibleIds({
          annotations: [withA, withB],
          settings: { visibleLabelIds: [] },
        })
      ).toHaveLength(2);
    });

    test("visibleLabelIds [] and null both mean no filter", () => {
      const withA = makeAnnot({ id: "a-annot", label: labelA });
      const withB = makeAnnot({ id: "b-annot", label: labelB });
      const annotations = [withA, withB];
      expect(
        visibleIds({ annotations, settings: { visibleLabelIds: [] } })
      ).toEqual(["a-annot", "b-annot"]);
      expect(
        visibleIds({ annotations, settings: { visibleLabelIds: null } })
      ).toEqual(["a-annot", "b-annot"]);
    });

    test("applies label filter to structural annotations too", () => {
      const structA = makeAnnot({ id: "sa", label: labelA, structural: true });
      const structB = makeAnnot({ id: "sb", label: labelB, structural: true });
      expect(
        visibleIds({
          annotations: [structA, structB],
          settings: { visibleLabelIds: [labelB.id] },
        })
      ).toEqual(["sb"]);
    });
  });

  describe("forced-by-selection", () => {
    test("keeps a selected annotation even if its label is filtered out", () => {
      const withA = makeAnnot({ id: "a-annot", label: labelA });
      const withB = makeAnnot({ id: "b-annot", label: labelB });
      expect(
        visibleIds({
          annotations: [withA, withB],
          settings: { visibleLabelIds: [labelA.id] }, // B would be filtered…
          selectedAnnotationIds: ["b-annot"], // …but it is selected.
        }).sort()
      ).toEqual(["a-annot", "b-annot"]);
    });

    test("a selected annotation is visible even when its label is filtered out", () => {
      const withA = makeAnnot({ id: "a-annot", label: labelA });
      const withB = makeAnnot({ id: "b-annot", label: labelB });
      expect(
        visibleIds({
          annotations: [withA, withB],
          settings: { visibleLabelIds: [labelA.id] },
          selectedAnnotationIds: ["b-annot"],
        })
      ).toContain("b-annot");
    });

    test("keeps a selected structural annotation even when showStructural is false", () => {
      const structural = makeAnnot({ id: "struct", structural: true });
      expect(
        visibleIds({
          annotations: [structural],
          settings: { showStructural: false },
          selectedAnnotationIds: ["struct"],
        })
      ).toEqual(["struct"]);
    });
  });

  describe("forced-by-selected-relation", () => {
    test("shows source + target annotations of a selected relation (showStructural=true)", () => {
      const src = makeAnnot({ id: "src", label: labelB });
      const tgt = makeAnnot({ id: "tgt", label: labelB });
      const other = makeAnnot({ id: "other", label: labelB });
      const rel = makeRelation("rel-1", ["src"], ["tgt"]);

      expect(
        visibleIds({
          annotations: [src, tgt, other],
          relations: [rel],
          // the label filter would hide ALL three (labelB, filter is labelA)
          settings: { visibleLabelIds: [labelA.id] },
          selectedRelationIds: ["rel-1"],
        }).sort()
      ).toEqual(["src", "tgt"]); // "other" still filtered out
    });

    test("applies forced-by-selected-relation even when showStructural is false (issue #1289)", () => {
      // Explicit relation selection is a user-initiated signal and forces its
      // members visible regardless of the showStructural toggle, mirroring
      // forced-by-selection for individual annotations.
      const src = makeAnnot({ id: "src" });
      const tgt = makeAnnot({ id: "tgt" });
      const rel = makeRelation("rel-1", ["src"], ["tgt"]);

      expect(
        visibleIds({
          annotations: [src, tgt],
          relations: [rel],
          settings: { showStructural: false, visibleLabelIds: [labelB.id] },
          selectedRelationIds: ["rel-1"],
        }).sort()
      ).toEqual(["src", "tgt"]);
    });

    test("keeps structural relation members visible when showStructural is false but the relation is selected", () => {
      const src = makeAnnot({ id: "src", structural: true });
      const tgt = makeAnnot({ id: "tgt", structural: true });
      const rel = makeRelation("rel-1", ["src"], ["tgt"]);

      expect(
        visibleIds({
          annotations: [src, tgt],
          relations: [rel],
          settings: { showStructural: false },
          selectedRelationIds: ["rel-1"],
        }).sort()
      ).toEqual(["src", "tgt"]);
    });

    test("endpoints of a relation in selectedRelationIds are visible when structural is hidden", () => {
      const src = makeAnnot({ id: "src", structural: true });
      const tgt = makeAnnot({ id: "tgt", structural: true });
      const unrelated = makeAnnot({ id: "unrelated", structural: true });
      const rel = makeRelation("rel-1", ["src"], ["tgt"]);

      expect(
        visibleIds({
          annotations: [src, tgt, unrelated],
          relations: [rel],
          settings: { showStructural: false },
          selectedRelationIds: ["rel-1"],
        })
      ).toEqual(["src", "tgt"]);
    });

    test("a selected relation id with no matching relation forces nothing", () => {
      const structural = makeAnnot({ id: "struct", structural: true });
      expect(
        visibleIds({
          annotations: [structural],
          relations: [],
          settings: { showStructural: false },
          selectedRelationIds: ["missing"],
        })
      ).toEqual([]);
    });

    test("only relations in selectedRelationIds force their endpoints", () => {
      const a = makeAnnot({ id: "a", structural: true });
      const b = makeAnnot({ id: "b", structural: true });
      const c = makeAnnot({ id: "c", structural: true });
      const d = makeAnnot({ id: "d", structural: true });
      expect(
        visibleIds({
          annotations: [a, b, c, d],
          relations: [
            makeRelation("rel-1", ["a"], ["b"]),
            makeRelation("rel-2", ["c"], ["d"]),
          ],
          settings: { showStructural: false },
          selectedRelationIds: ["rel-2"],
        })
      ).toEqual(["c", "d"]);
    });
  });

  describe("forced-by-all-relationships", () => {
    test("when showStructuralRelationships is on (and showStructural is on), all relation members are visible", () => {
      const src = makeAnnot({ id: "src", label: labelB });
      const tgt = makeAnnot({ id: "tgt", label: labelB });
      const loose = makeAnnot({ id: "loose", label: labelB });
      const rel = makeRelation("rel-1", ["src"], ["tgt"]);

      expect(
        visibleIds({
          annotations: [src, tgt, loose],
          relations: [rel],
          settings: {
            showStructural: true,
            showStructuralRelationships: true,
            visibleLabelIds: [labelA.id], // would hide all three
          },
        }).sort()
      ).toEqual(["src", "tgt"]); // loose still hidden
    });

    test("stays gated on showStructural: does NOT force-show relation members when showStructural is false and no relation is selected", () => {
      // Companion to the issue #1289 fix: the explicit selected-relation
      // bypass is un-gated, but the implicit showStructuralRelationships
      // bypass must remain gated on showStructural, otherwise toggling
      // structural off would have no effect on relation members at all.
      const src = makeAnnot({ id: "src", structural: true });
      const tgt = makeAnnot({ id: "tgt", structural: true });
      const rel = makeRelation("rel-1", ["src"], ["tgt"]);

      expect(
        visibleIds({
          annotations: [src, tgt],
          relations: [rel],
          settings: {
            showStructural: false,
            showStructuralRelationships: true,
          },
        })
      ).toEqual([]);
    });
  });

  describe("showSelectedOnly mode", () => {
    test("hides every annotation that is neither selected nor connected via a selected relation", () => {
      const selected = makeAnnot({ id: "sel" });
      const connected = makeAnnot({ id: "conn" });
      const unrelated = makeAnnot({ id: "other" });
      const rel = makeRelation("rel-1", ["sel"], ["conn"]);

      expect(
        visibleIds({
          annotations: [selected, connected, unrelated],
          relations: [rel],
          settings: { showSelectedOnly: true },
          selectedAnnotationIds: ["sel"],
          selectedRelationIds: ["rel-1"],
        }).sort()
      ).toEqual(["conn", "sel"]);
    });

    test("hides connected annotations when the linking relation is NOT selected", () => {
      const selected = makeAnnot({ id: "sel" });
      const other = makeAnnot({ id: "other" });
      const rel = makeRelation("rel-1", ["sel"], ["other"]);

      expect(
        visibleIds({
          annotations: [selected, other],
          relations: [rel],
          settings: { showSelectedOnly: true },
          selectedAnnotationIds: ["sel"],
          selectedRelationIds: [], // relation not selected
        })
      ).toEqual(["sel"]);
    });
  });

  describe("combined filters", () => {
    test("respects precedence: forced-by-selection beats showSelectedOnly + label filter", () => {
      const selected = makeAnnot({ id: "sel", label: labelB });
      const filtered = makeAnnot({ id: "filt", label: labelB });

      expect(
        visibleIds({
          annotations: [selected, filtered],
          settings: { showSelectedOnly: true, visibleLabelIds: [labelA.id] },
          selectedAnnotationIds: ["sel"],
        })
      ).toEqual(["sel"]);
    });
  });

  describe("null safety", () => {
    test("handles empty relations array gracefully", () => {
      const a = makeAnnot({ id: "a" });
      expect(
        visibleIds({
          annotations: [a],
          relations: [],
          settings: { showStructuralRelationships: true },
        })
      ).toEqual(["a"]);
    });
  });

  test("keeps the input order and returns a new array", () => {
    const annotations = [
      makeAnnot({ id: "c" }),
      makeAnnot({ id: "a" }),
      makeAnnot({ id: "b" }),
    ];
    const result = selectVisibleAnnotations({
      annotations,
      relations: [],
      selectedAnnotationIds: [],
      selectedRelationIds: [],
      settings: DEFAULT_DISPLAY_SETTINGS,
    });
    expect(result.map((a) => a.id)).toEqual(["c", "a", "b"]);
    expect(result).not.toBe(annotations);
  });
});

describe("useVisibleAnnotations", () => {
  function renderVisible() {
    return renderHook(
      () => ({ visible: useVisibleAnnotations(), store: useStore() }),
      { wrapper: AnnotatorProvider }
    );
  }
  const ids = (list: InternalAnnotation[]) => list.map((a) => a.id);

  test("is empty for a fresh instance", () => {
    expect(renderVisible().result.current.visible).toEqual([]);
  });

  test("filters the instance's annotations by its display settings and selection", () => {
    const { result } = renderVisible();
    const regular = makeAnnot({ id: "reg" });
    const structural = makeAnnot({ id: "struct", structural: true });
    const other = makeAnnot({ id: "other", structural: true });

    act(() => {
      result.current.store.set(annotationsAtom, [regular, structural, other]);
    });
    // Structural annotations are hidden by default.
    expect(ids(result.current.visible)).toEqual(["reg"]);

    act(() => {
      result.current.store.set(selectedAnnotationIdsAtom, ["struct"]);
    });
    expect(ids(result.current.visible)).toEqual(["reg", "struct"]);

    act(() => {
      result.current.store.set(displaySettingsAtom, {
        ...DEFAULT_DISPLAY_SETTINGS,
        showStructural: true,
      });
    });
    expect(ids(result.current.visible)).toEqual(["reg", "struct", "other"]);
  });

  test("follows selected relations", () => {
    const { result } = renderVisible();
    act(() => {
      result.current.store.set(annotationsAtom, [
        makeAnnot({ id: "src", structural: true }),
        makeAnnot({ id: "tgt", structural: true }),
        makeAnnot({ id: "far", structural: true }),
      ]);
      result.current.store.set(relationsAtom, [
        makeRelation("rel-1", ["src"], ["tgt"]),
      ]);
      result.current.store.set(selectedRelationIdsAtom, ["rel-1"]);
    });
    expect(ids(result.current.visible)).toEqual(["src", "tgt"]);
  });

  test("keeps the same array while nothing it depends on changes", () => {
    const { result, rerender } = renderVisible();
    act(() => {
      result.current.store.set(annotationsAtom, [makeAnnot({ id: "a" })]);
    });
    const first = result.current.visible;
    rerender();
    expect(result.current.visible).toBe(first);
  });
});
