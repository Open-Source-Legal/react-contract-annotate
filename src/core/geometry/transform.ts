import { PAWLS_COORDINATE_EPSILON } from "../constants";
import type { BoundingBox, PawlsPage, PawlsToken } from "../types";

export function hexToRgb(hex: string) {
  // For shortsighted reasons, the color stored is missing #. Check first to see if number is missing hex, if so
  // add it and THEN run the
  try {
    let color_str = hex.substring(0, 1) !== "#" ? "#" + hex : hex;

    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(color_str);
    if (!result) {
      throw new Error("Unable to parse color.");
    }
    return {
      r: parseInt(result[1], 16),
      g: parseInt(result[2], 16),
      b: parseInt(result[3], 16),
    };
  } catch {
    return {
      r: 255,
      g: 255,
      b: 0,
    };
  }
}

// Function to determine contrasting text color
export const getContrastColor = (hexColor: string) => {
  // Convert hex to RGB
  const r = parseInt(hexColor.slice(1, 3), 16);
  const g = parseInt(hexColor.slice(3, 5), 16);
  const b = parseInt(hexColor.slice(5, 7), 16);

  // Calculate luminance
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;

  // Return black or white depending on luminance
  return luminance > 0.5 ? "#000000" : "#FFFFFF";
};

/**
 * Returns the provided bounds scaled by the provided factor.
 */
export function scaled(bounds: BoundingBox, scale: number): BoundingBox {
  return {
    left: bounds.left * scale,
    top: bounds.top * scale,
    right: bounds.right * scale,
    bottom: bounds.bottom * scale,
  };
}

/**
 * Computes a bound which contains all of the bounds passed as arguments.
 */
export function spanningBound(
  bounds: BoundingBox[],
  padding: number = 3
): BoundingBox {
  // Start with a bounding box for which any bound would be
  // contained within, meaning we immediately update maxBound.
  const maxBound: BoundingBox = {
    left: Number.MAX_VALUE,
    top: Number.MAX_VALUE,
    right: 0,
    bottom: 0,
  };

  bounds.forEach((bound) => {
    maxBound.bottom = Math.max(bound.bottom, maxBound.bottom);
    maxBound.top = Math.min(bound.top, maxBound.top);
    maxBound.left = Math.min(bound.left, maxBound.left);
    maxBound.right = Math.max(bound.right, maxBound.right);
  });

  maxBound.top = maxBound.top - padding;
  maxBound.left = maxBound.left - padding;
  maxBound.right = maxBound.right + padding;
  maxBound.bottom = maxBound.bottom + padding;

  return maxBound;
}

/**
 * Returns the provided bounds in their normalized form. Normalized means that the left
 * coordinate is always less than the right coordinate, and that the top coordinate is always
 * left than the bottom coordinate.
 *
 * This is required because objects in the DOM are positioned and sized by setting their top-left
 * corner, width and height. This means that when a user composes a selection and moves to the left,
 * or up, from where they started might result in a negative width and/or height. We don't normalize
 * these values as we're tracking the mouse as it'd result in the wrong visual effect. Instead we
 * rotate the bounds we render on the appropriate axis. This means we need to account for this
 * later when calculating what tokens the bounds intersect with.
 */
export function normalizeBounds(b: BoundingBox): BoundingBox {
  const normalized = Object.assign({}, b);
  if (b.right < b.left) {
    const l = b.left;
    normalized.left = b.right;
    normalized.right = l;
  }
  if (b.bottom < b.top) {
    const t = b.top;
    normalized.top = b.bottom;
    normalized.bottom = t;
  }
  return normalized;
}

/**
 * Returns true if the provided bounds overlap.
 */
export function doOverlap(a: BoundingBox, b: BoundingBox): boolean {
  if (a.left >= b.right || a.right <= b.left) {
    return false;
  } else if (a.bottom <= b.top || a.top >= b.bottom) {
    return false;
  }
  return true;
}

/**
 * Normalizes PAWLs token coordinates to match PDF.js viewport coordinates.
 *
 * PAWLs tokens are extracted by the parser (e.g. Docling, pdfplumber) using its
 * own page dimension measurements. PDF.js computes its own page dimensions from
 * the PDF's MediaBox/CropBox/rotation. If these differ, token bounding boxes
 * drift progressively from the rendered PDF content.
 *
 * This function rescales token x/y/width/height so they align with the PDF.js
 * coordinate system at scale 1.
 *
 * @param pawlsPage  - The PAWLs page data containing `page` dimensions and `tokens`.
 * @param viewportWidth  - PDF.js viewport width at scale 1.
 * @param viewportHeight - PDF.js viewport height at scale 1.
 * @returns A new array of tokens with coordinates rescaled to the PDF.js
 *          coordinate system. If no rescaling is needed the original array is
 *          returned as-is (no unnecessary copies).
 */
export function normalizeTokensToPdfViewport(
  pawlsPage: PawlsPage,
  viewportWidth: number,
  viewportHeight: number
): PawlsToken[] {
  const pawlsWidth = pawlsPage.page.width;
  const pawlsHeight = pawlsPage.page.height;

  // Cannot rescale if PAWLs or viewport reports zero dimensions (malformed data).
  if (
    pawlsWidth === 0 ||
    pawlsHeight === 0 ||
    viewportWidth === 0 ||
    viewportHeight === 0
  ) {
    return pawlsPage.tokens;
  }

  // If dimensions match (within a tiny epsilon) no rescaling is needed.
  if (
    Math.abs(pawlsWidth - viewportWidth) < PAWLS_COORDINATE_EPSILON &&
    Math.abs(pawlsHeight - viewportHeight) < PAWLS_COORDINATE_EPSILON
  ) {
    return pawlsPage.tokens;
  }

  const scaleX = viewportWidth / pawlsWidth;
  const scaleY = viewportHeight / pawlsHeight;

  return pawlsPage.tokens.map((t) => ({
    ...t,
    x: t.x * scaleX,
    y: t.y * scaleY,
    width: t.width * scaleX,
    height: t.height * scaleY,
  }));
}

/**
 * Resolves the token array for a single PDF page given the full PAWLs dataset.
 *
 * Validates the PAWLs data for the requested page index and, when valid,
 * normalizes token coordinates to the PDF.js viewport coordinate space via
 * {@link normalizeTokensToPdfViewport}.
 *
 * @param pawlsData - The full PAWLs dataset (array of per-page token data).
 * @param pageIndex - Zero-based page index into `pawlsData`.
 * @param viewportWidth  - PDF.js viewport width at scale 1.
 * @param viewportHeight - PDF.js viewport height at scale 1.
 * @param pageNum - One-based page number (used only for log messages).
 * @returns The resolved (and possibly rescaled) token array for the page.
 */
export function resolvePageTokens(
  pawlsData: PawlsPage[] | null | undefined,
  pageIndex: number,
  viewportWidth: number,
  viewportHeight: number,
  pageNum: number
): PawlsToken[] {
  if (
    !pawlsData ||
    !Array.isArray(pawlsData) ||
    pageIndex >= pawlsData.length
  ) {
    console.warn(
      `Page ${pageNum}: PAWLS data index out of bounds. Index: ${pageIndex}, Length: ${
        pawlsData?.length ?? 0
      }`
    );
    return [];
  }

  const pageData = pawlsData[pageIndex];

  if (!pageData) {
    return [];
  }
  if (typeof pageData.tokens === "undefined") {
    return [];
  }
  if (!Array.isArray(pageData.tokens)) {
    console.error(
      `Page ${pageNum}: CRITICAL - pageData.tokens is not an array at index ${pageIndex}! Type: ${typeof pageData.tokens}`
    );
    return [];
  }

  return normalizeTokensToPdfViewport(pageData, viewportWidth, viewportHeight);
}
