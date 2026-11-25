/**
 * Captures the geometry OpenContracts' own renderer produces for the eton
 * fixture, as the reference for `src/pdf/__tests__/parity.test.tsx`.
 *
 * This file is NOT part of the library's test suite or type-check. It is
 * copied into an OpenContracts checkout at `98286cabf` and run there:
 *
 *   cd <oc>/frontend && yarn install --frozen-lockfile
 *   mkdir -p src/__parity__ && cp <this file> src/__parity__/
 *   RCA_FIXTURES=<library>/fixtures yarn vitest run src/__parity__/capture.test.tsx
 *   rm -rf src/__parity__
 *
 * It builds OpenContracts' `PDFPageInfo` for each page from `pawls.json` (OC's
 * `resolvePageTokens`, a stub `PDFPageProxy` whose viewport is the PAWLs page
 * size times the scale), constructs OC `ServerTokenAnnotation`s from
 * `annotations.json` (which expands the compact v2 JSON), renders OC's
 * `SelectionBoundary` and `SelectionTokenGroup` the way OC's `Selection` does
 * (`bounds = pageInfo.getScaledBounds(json[page].bounds)`), reads their inline
 * `left` / `top` / `width` / `height` and writes
 * `<RCA_FIXTURES>/parity/eton.json`.
 *
 * Token indices the page does not have are left out: OpenContracts drew a
 * zero-size rect for them and the library skips them, so the comparison is
 * made on the tokens both draw.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SelectionBoundary } from "../components/annotator/display/components/SelectionBoundary";
import { SelectionTokenGroup } from "../components/annotator/display/components/SelectionTokenGroup";
import { ServerTokenAnnotation } from "../components/annotator/types/annotations";
import { PDFPageInfo } from "../components/annotator/types/pdf";
import type { PageTokens } from "../components/types";
import { resolvePageTokens } from "../utils/transform";

// The boundary reads the annotation-ref registry and `isCreatingAnnotation`;
// OpenContracts' own unit tests mock both the same way.
vi.mock("../components/annotator/hooks/useAnnotationRefs", () => ({
  useAnnotationRefs: () => ({
    registerRef: vi.fn(),
    unregisterRef: vi.fn(),
  }),
}));

vi.mock("jotai", async () => {
  const actual = await vi.importActual<typeof import("jotai")>("jotai");
  return { ...actual, useAtomValue: vi.fn(() => false) };
});

const COMMIT = "98286cabf";
const ZOOMS = [1, 1.5];
/** The annotations compared; `a-multi` covers two pages. */
const ANNOTATION_IDS = ["a-title", "a-compact", "a-multi", "a-far"];
const EXPECTED_CASES = 10;

type Rect = { left: number; top: number; width: number; height: number };

const fixturesDir = process.env.RCA_FIXTURES;

function readFixture<T>(relative: string): T {
  return JSON.parse(
    readFileSync(path.join(fixturesDir as string, relative), "utf8")
  ) as T;
}

/** The inline `left` / `top` / `width` / `height` of an element, in px. */
function rectOf(element: HTMLElement): Rect {
  const px = (value: string) => parseFloat(value);
  return {
    left: px(element.style.left),
    top: px(element.style.top),
    width: px(element.style.width),
    height: px(element.style.height),
  };
}

/** A pdf.js page of the PAWLs page's size, as far as OpenContracts reads it. */
function stubPage(pawlsPage: PageTokens, pageNumber: number) {
  return {
    pageNumber,
    getViewport: ({ scale }: { scale: number }) => ({
      width: pawlsPage.page.width * scale,
      height: pawlsPage.page.height * scale,
    }),
  };
}

describe("capture OpenContracts geometry", () => {
  it("writes fixtures/parity/eton.json", () => {
    expect(
      fixturesDir,
      "set RCA_FIXTURES to the library's fixtures directory"
    ).toBeTruthy();

    const pawls = readFixture<PageTokens[]>("eton/pawls.json");
    const rawAnnotations = readFixture<
      Array<{
        id: string;
        page: number;
        rawText: string;
        structural?: boolean;
        annotationLabel: Record<string, unknown>;
        json: Record<string, unknown>;
      }>
    >("eton/annotations.json");

    const pageAt = (pageIndex: number, zoom: number): PDFPageInfo => {
      const pawlsPage = pawls[pageIndex];
      const page = stubPage(pawlsPage, pageIndex + 1);
      const viewport = page.getViewport({ scale: 1 });
      const tokens = resolvePageTokens(
        pawls,
        pageIndex,
        viewport.width,
        viewport.height,
        pageIndex + 1
      );
      return new PDFPageInfo(page as never, tokens, zoom);
    };

    const cases: Array<{
      id: string;
      pageIndex: number;
      zoom: number;
      boundary: Rect;
      tokens: Rect[];
    }> = [];

    for (const id of ANNOTATION_IDS) {
      const raw = rawAnnotations.find((a) => a.id === id);
      expect(raw, `annotation ${id} is in the fixture`).toBeDefined();
      const annotation = new ServerTokenAnnotation(
        raw!.page,
        raw!.annotationLabel as never,
        raw!.rawText,
        raw!.structural ?? false,
        raw!.json,
        [],
        false,
        false,
        false,
        raw!.id
      );
      const pageIndices = Object.keys(annotation.json)
        .map(Number)
        .sort((a, b) => a - b);

      for (const zoom of ZOOMS) {
        for (const pageIndex of pageIndices) {
          const pageInfo = pageAt(pageIndex, zoom);
          const pageJson = annotation.json[pageIndex];

          // Exactly as OpenContracts' `Selection` computes the box.
          const bounds = pageInfo.getScaledBounds(pageJson.bounds);
          const boundary = render(
            <SelectionBoundary
              id={annotation.id}
              hidden={false}
              showBoundingBox
              color={annotation.annotationLabel.color as string}
              bounds={bounds}
              selected={false}
            />
          );
          const boundaryRect = rectOf(
            boundary.container.querySelector("span") as HTMLElement
          );
          boundary.unmount();

          const drawable = (pageJson.tokensJsons ?? []).filter(
            (t) => pageInfo.tokens[t.tokenIndex] !== undefined
          );
          const group = render(
            <SelectionTokenGroup
              color={annotation.annotationLabel.color as string}
              highOpacity={false}
              pageInfo={pageInfo}
              tokens={drawable}
            />
          );
          const tokenRects = Array.from(
            group.container.querySelectorAll<HTMLElement>("div > span")
          ).map(rectOf);
          group.unmount();

          expect(tokenRects).toHaveLength(drawable.length);
          cases.push({
            id,
            pageIndex,
            zoom,
            boundary: boundaryRect,
            tokens: tokenRects,
          });
        }
      }
    }

    expect(cases).toHaveLength(EXPECTED_CASES);
    const out = path.join(fixturesDir as string, "parity", "eton.json");
    mkdirSync(path.dirname(out), { recursive: true });
    writeFileSync(
      out,
      `${JSON.stringify({ commit: COMMIT, cases }, null, 2)}\n`
    );
  });
});
