/**
 * Ported from OpenContracts' `NativeLinkLayer.test.tsx` (98286cabf): pdf.js
 * link annotations surface as real <a> elements positioned by the page's
 * viewport, and unsafe URLs never reach the DOM. The layer now opens links
 * through the annotator (`useOpenLink`), so it renders inside a real
 * `AnnotatorShell`; jest-dom matchers are replaced by plain assertions.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { PDFPageProxy } from "pdfjs-dist/types/src/display/api";
import type { ReactNode } from "react";

import { AnnotatorShell } from "../../core/index";
import type { AnnotatorCommonProps } from "../../core/index";
import { NativeLinkLayer } from "../NativeLinkLayer";

type FakeLinkAnnotation = {
  id: string;
  subtype?: string;
  url?: string;
  rect?: number[];
};

const makePage = (annotations: FakeLinkAnnotation[]): PDFPageProxy => {
  return {
    getAnnotations: vi.fn().mockResolvedValue(annotations),
    // Mock honours the `scale` arg so the test for scaled positioning can
    // verify that NativeLinkLayer actually forwards the prop into
    // ``getViewport({ scale })``.
    getViewport: vi.fn(({ scale = 1 }: { scale?: number } = {}) => ({
      convertToViewportPoint: (x: number, y: number) => [x * scale, y * scale],
    })),
  } as unknown as PDFPageProxy;
};

function inAnnotator(
  children: ReactNode,
  common: Partial<AnnotatorCommonProps> = {}
) {
  return render(
    <AnnotatorShell common={{ annotations: [], ...common }} handleRef={null}>
      {children}
    </AnnotatorShell>
  );
}

const SAFE_LINK: FakeLinkAnnotation = {
  id: "ann-1",
  subtype: "Link",
  url: "https://example.com",
  rect: [10, 20, 110, 40],
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("NativeLinkLayer", () => {
  it("renders an <a> for each safe Link annotation", async () => {
    const page = makePage([
      SAFE_LINK,
      {
        id: "ann-2",
        subtype: "Link",
        url: "mailto:test@example.com",
        rect: [0, 0, 50, 50],
      },
    ]);

    inAnnotator(<NativeLinkLayer page={page} scale={1} />);

    await waitFor(() => {
      expect(screen.getAllByRole("link")).toHaveLength(2);
    });

    const links = screen.getAllByRole("link");
    expect(links[0].getAttribute("href")).toBe("https://example.com");
    expect(links[0].getAttribute("target")).toBe("_blank");
    expect(links[0].getAttribute("rel")).toBe("noopener noreferrer");
    expect(links[1].getAttribute("href")).toBe("mailto:test@example.com");
  });

  it("filters out unsafe protocols", async () => {
    const page = makePage([
      {
        id: "ann-1",
        subtype: "Link",
        url: "javascript:alert(1)",
        rect: [0, 0, 10, 10],
      },
      {
        id: "ann-2",
        subtype: "Link",
        url: "file:///etc/passwd",
        rect: [0, 0, 10, 10],
      },
      {
        id: "ann-3",
        subtype: "Link",
        url: "https://safe.example",
        rect: [0, 0, 10, 10],
      },
    ]);

    inAnnotator(<NativeLinkLayer page={page} scale={1} />);

    await waitFor(() => {
      expect(screen.getAllByRole("link")).toHaveLength(1);
    });
    expect(screen.getByRole("link").getAttribute("href")).toBe(
      "https://safe.example"
    );
  });

  it("ignores non-Link annotations and Links without a URL", async () => {
    const page = makePage([
      { id: "w", subtype: "Widget", rect: [0, 0, 10, 10] },
      { id: "l-no-url", subtype: "Link", rect: [0, 0, 10, 10] },
      {
        id: "l-ok",
        subtype: "Link",
        url: "https://example.com",
        rect: [0, 0, 10, 10],
      },
    ]);

    inAnnotator(<NativeLinkLayer page={page} scale={1} />);

    await waitFor(() => {
      expect(screen.getAllByRole("link")).toHaveLength(1);
    });
  });

  it("renders nothing when there are no link annotations", async () => {
    const page = makePage([]);
    const { container } = inAnnotator(<NativeLinkLayer page={page} scale={1} />);

    // Resolve the promise chain so the empty-state branch runs.
    await waitFor(() => {
      expect(page.getAnnotations).toHaveBeenCalled();
    });
    expect(container.querySelector("a")).toBeNull();
  });

  it("positions links using the scaled viewport rectangle", async () => {
    const page = makePage([SAFE_LINK]);

    inAnnotator(<NativeLinkLayer page={page} scale={2} />);

    const link = await waitFor(() => screen.getByRole("link"));
    // Mock viewport multiplies by the passed scale; layer uses min/abs.
    const { left, top, width, height } = link.style;
    expect({ left, top, width, height }).toEqual({
      left: "20px",
      top: "40px",
      width: "200px",
      height: "40px",
    });
    // Scale prop must actually flow into the PDF.js viewport call —
    // otherwise the overlay would render at the wrong zoom level.
    expect(page.getViewport).toHaveBeenCalledWith({ scale: 2 });
  });

  it("exposes an aria-label for screen readers", async () => {
    const page = makePage([SAFE_LINK]);

    inAnnotator(<NativeLinkLayer page={page} scale={1} />);

    await waitFor(() => {
      expect(
        screen.getByRole("link", { name: "https://example.com" })
      ).toBeTruthy();
    });
  });
});

describe("NativeLinkLayer clicks", () => {
  it("hands the URL to onOpenLink with source 'native' instead of navigating", async () => {
    const onOpenLink = vi.fn();
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    const page = makePage([SAFE_LINK]);
    inAnnotator(<NativeLinkLayer page={page} scale={1} />, { onOpenLink });

    const link = await waitFor(() => screen.getByRole("link"));
    const notPrevented = fireEvent.click(link);

    expect(onOpenLink.mock.calls).toEqual([["https://example.com", "native"]]);
    expect(notPrevented).toBe(false);
    expect(open).not.toHaveBeenCalled();
  });

  it("without onOpenLink opens an http(s) link in a new tab with noopener", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    const page = makePage([SAFE_LINK]);
    inAnnotator(<NativeLinkLayer page={page} scale={1} />);

    const link = await waitFor(() => screen.getByRole("link"));
    fireEvent.click(link);

    expect(open.mock.calls).toEqual([
      ["https://example.com", "_blank", "noopener,noreferrer"],
    ]);
  });

  it("without onOpenLink ignores a mailto: link", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    const page = makePage([
      { id: "m", subtype: "Link", url: "mailto:a@b.c", rect: [0, 0, 5, 5] },
    ]);
    inAnnotator(<NativeLinkLayer page={page} scale={1} />);

    const link = await waitFor(() => screen.getByRole("link"));
    const notPrevented = fireEvent.click(link);

    expect(notPrevented).toBe(false);
    expect(open).not.toHaveBeenCalled();
  });
});
