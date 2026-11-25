import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";

import { AnnotatorShell } from "../AnnotatorShell";
import { isUrlAnnotation, useOpenLink } from "../links";
import type { Annotation, AnnotatorCommonProps } from "../types";

const SOURCE: Annotation = {
  id: "a1",
  annotationLabel: { id: "l1", text: "OC_URL" },
  json: { start: 0, end: 4 },
  linkUrl: "https://example.com",
};

function openLink(common: Partial<AnnotatorCommonProps> = {}) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <AnnotatorShell common={{ annotations: [], ...common }} handleRef={null}>
      {children}
    </AnnotatorShell>
  );
  return renderHook(() => useOpenLink(), { wrapper }).result.current;
}

afterEach(() => {
  vi.restoreAllMocks();
});

test("with onOpenLink, every URL goes to the host and nothing is opened", () => {
  const open = vi.spyOn(window, "open").mockReturnValue(null);
  const onOpenLink = vi.fn();
  const open1 = openLink({ onOpenLink });

  open1("https://example.com", SOURCE);
  open1("javascript:alert(1)", "native");

  expect(onOpenLink.mock.calls).toEqual([
    ["https://example.com", SOURCE],
    ["javascript:alert(1)", "native"],
  ]);
  expect(open).not.toHaveBeenCalled();
});

test("without onOpenLink, http(s) URLs open in a new tab with noopener", () => {
  const open = vi.spyOn(window, "open").mockReturnValue(null);
  const open1 = openLink();

  open1("https://example.com/terms", SOURCE);
  open1("HTTP://example.com", "native");

  expect(open.mock.calls).toEqual([
    ["https://example.com/terms", "_blank", "noopener,noreferrer"],
    ["HTTP://example.com", "_blank", "noopener,noreferrer"],
  ]);
});

test("without onOpenLink, any other URL is ignored", () => {
  const open = vi.spyOn(window, "open").mockReturnValue(null);
  const open1 = openLink();

  for (const url of [
    "javascript:alert(1)",
    "mailto:a@b.c",
    "file:///etc/passwd",
    "/d/relative",
    "//evil.example",
    "",
    "not a url",
  ]) {
    open1(url, SOURCE);
  }

  expect(open).not.toHaveBeenCalled();
});

test("isUrlAnnotation: true only for a non-blank linkUrl", () => {
  expect(isUrlAnnotation({ linkUrl: "https://example.com" })).toBe(true);
  expect(isUrlAnnotation({ linkUrl: "   " })).toBe(false);
  expect(isUrlAnnotation({ linkUrl: null })).toBe(false);
  expect(isUrlAnnotation({})).toBe(false);
});
