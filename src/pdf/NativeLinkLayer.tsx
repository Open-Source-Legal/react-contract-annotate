/**
 * Renders PDF.js native link annotations (URLs embedded in the PDF) as
 * transparent <a> elements positioned over their canvas-painted rectangles.
 * Ported from OpenContracts' `renderers/pdf/NativeLinkLayer.tsx` (98286cabf).
 *
 * Native links exist only as pixels in the canvas raster; stacking real
 * anchors above the page's other layers keeps them clickable and gives
 * right-click "open in new tab", keyboard focus, and screen-reader support
 * for free.
 *
 * Changed from OpenContracts: a click goes through `useOpenLink` (the host's
 * `onOpenLink` with source `"native"`, else a new `noopener` tab for http(s)
 * only), a failure to read the page's annotations after the page left the
 * view is not reported, and the layer's stacking is `--rca-z-native-links`
 * (default `Z_INDEX.PDF_NATIVE_LINK_LAYER`).
 */
import { useEffect, useMemo, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import type { PDFPageProxy } from "pdfjs-dist/types/src/display/api";

import { styled, useOpenLink } from "../core/index";
import { Z_INDEX } from "./constants";

interface NativeLink {
  id: string;
  url: string;
  left: number;
  top: number;
  width: number;
  height: number;
}

interface NativeLinkLayerProps {
  page: PDFPageProxy;
  scale: number;
}

const SAFE_URL_PROTOCOLS: readonly string[] = Object.freeze([
  "http:",
  "https:",
  "mailto:",
]);

const isSafeUrl = (url: string): boolean => {
  try {
    const parsed = new URL(url);
    return SAFE_URL_PROTOCOLS.includes(parsed.protocol);
  } catch {
    return false;
  }
};

type PdfRect = [number, number, number, number];

export function NativeLinkLayer({ page, scale }: NativeLinkLayerProps) {
  const openLink = useOpenLink();
  const [rawLinks, setRawLinks] = useState<
    { id: string; url: string; rect: PdfRect }[]
  >([]);

  useEffect(() => {
    // Clear stale positions immediately so a recycled component instance
    // (or a future page-prop swap) does not briefly render the previous
    // page's links before the async fetch resolves.
    setRawLinks([]);
    let cancelled = false;
    (async () => {
      try {
        const annotations = (await page.getAnnotations()) as Array<{
          id: string;
          subtype?: string;
          url?: string;
          rect?: number[];
        }>;
        if (cancelled) return;
        const collected: { id: string; url: string; rect: PdfRect }[] = [];
        for (const ann of annotations) {
          // ``ann.url`` absent → dest-based intra-document link, out of
          // scope for this overlay (no external navigation target).
          if (
            ann.subtype !== "Link" ||
            !ann.url ||
            !ann.rect ||
            ann.rect.length !== 4 ||
            !isSafeUrl(ann.url)
          ) {
            continue;
          }
          collected.push({
            id: ann.id,
            url: ann.url,
            rect: ann.rect as PdfRect,
          });
        }
        setRawLinks(collected);
      } catch (err) {
        // The page unmounted (or its document was destroyed) meanwhile.
        if (cancelled) return;
        console.warn("Failed to read native PDF link annotations:", err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [page]);

  const links: NativeLink[] = useMemo(() => {
    if (rawLinks.length === 0) return [];
    const viewport = page.getViewport({ scale });
    return rawLinks.map(({ id, url, rect }) => {
      // pdfjs-dist 5+ dropped ``convertToViewportRectangle``; converting the
      // two opposite corners is exactly what it did.
      const [x1, y1] = viewport.convertToViewportPoint(rect[0], rect[1]);
      const [x2, y2] = viewport.convertToViewportPoint(rect[2], rect[3]);
      return {
        id,
        url,
        left: Math.min(x1, x2),
        top: Math.min(y1, y2),
        width: Math.abs(x2 - x1),
        height: Math.abs(y2 - y1),
      };
    });
  }, [rawLinks, page, scale]);

  if (links.length === 0) return null;

  const onLinkClick = (event: ReactMouseEvent, url: string) => {
    event.preventDefault();
    openLink(url, "native");
  };

  return (
    <LinkOverlay data-rca-native-links="">
      {links.map((link) => (
        <NativeLinkAnchor
          key={link.id}
          href={link.url}
          target="_blank"
          rel="noopener noreferrer"
          title={link.url}
          aria-label={link.url}
          onClick={(event) => onLinkClick(event, link.url)}
          style={{
            left: link.left,
            top: link.top,
            width: link.width,
            height: link.height,
          }}
        />
      ))}
    </LinkOverlay>
  );
}

const LinkOverlay = styled.div`
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: var(--rca-z-native-links, ${Z_INDEX.PDF_NATIVE_LINK_LAYER});
`;

const NativeLinkAnchor = styled.a`
  position: absolute;
  pointer-events: auto;
  cursor: pointer;
  background: transparent;
  text-decoration: none;

  &:hover {
    background: rgba(0, 120, 215, 0.12);
    outline: 1px solid rgba(0, 120, 215, 0.4);
  }

  &:focus-visible {
    outline: 2px solid rgba(0, 120, 215, 0.7);
    outline-offset: 1px;
  }
`;
