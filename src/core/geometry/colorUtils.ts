/**
 * Colour helpers shared by the formats: whether a colour from host data is
 * safe to write into CSS, and the halo of an annotation box.
 */

import {
  BOUNDARY_SHADOW_SELECTED,
  BOUNDARY_SHADOW_UNSELECTED,
} from "../constants";

/**
 * Returns a CSS-color value that is safe to interpolate directly into a CSS
 * property (e.g. ``background: ${color}``). A bare hex color (#RGB, #RRGGBB,
 * #RRGGBBAA), a plain alphabetic named color (``red``, ``blue``), or a
 * functional ``rgb()/rgba()/hsl()/hsla()`` notation whose body contains ONLY
 * numerics and separators is allowed through; anything else — including values
 * with ``;``, ``{``, ``(`` (outside the allowed functions) or whitespace that
 * could break out of the property — collapses to ``fallback``. Guards against
 * (self-)XSS when the color originates from user-controlled data such as
 * annotation-label colors.
 *
 * The functional form is intentionally permissive about *which* numbers appear
 * (it does not range-check channels) but strict about *what characters* may
 * appear inside the parens (digits, ``.``, ``,``, ``%``, ``/`` and spaces only),
 * which is what makes it injection-safe.
 *
 * @param value - Candidate color string, or null/undefined
 * @param fallback - Color returned when ``value`` is missing/unsafe
 * @returns A safe CSS color string
 *
 * @example
 * safeCssColor("#4A90E2", "#000")              // "#4A90E2"
 * safeCssColor("red", "#000")                  // "red"
 * safeCssColor("rgb(255, 0, 0)", "#000")       // "rgb(255, 0, 0)"
 * safeCssColor("rgba(0,0,0,.5)", "#000")       // "rgba(0,0,0,.5)"
 * safeCssColor("red; } body { x:y", "#000")    // "#000"
 * safeCssColor("rgb(1); evil", "#000")         // "#000"
 * safeCssColor(null, "#000")                   // "#000"
 */
export function safeCssColor(
  value: string | null | undefined,
  fallback: string
): string {
  if (!value) return fallback;
  const trimmed = value.trim();
  const isHex = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(
    trimmed
  );
  const isNamed = /^[a-zA-Z]+$/.test(trimmed);
  // Functional notation: only the four color functions, and only numeric /
  // separator characters between the parens — no letters, ``;``, ``{`` etc.
  const isFunctional = /^(?:rgb|rgba|hsl|hsla)\([0-9.,%/\s]+\)$/i.test(trimmed);
  return isHex || isNamed || isFunctional ? trimmed : fallback;
}

/**
 * Computes a multi-layer diffuse box-shadow for annotation bounding boxes.
 * Used by both SelectionBoundary and ResultBoundary to produce a soft
 * highlighter-pen glow effect.
 *
 * @param r - Red channel (0-255)
 * @param g - Green channel (0-255)
 * @param b - Blue channel (0-255)
 * @param selected - Whether the annotation is currently selected
 * @returns A CSS box-shadow string, or "none" if not visible
 */
export function computeAnnotationBoxShadow(
  r: number,
  g: number,
  b: number,
  selected: boolean
): string {
  const s = selected ? BOUNDARY_SHADOW_SELECTED : BOUNDARY_SHADOW_UNSELECTED;

  return [
    `0 0 ${s.outerBlur}px ${s.outerSpread}px rgba(${r}, ${g}, ${b}, ${s.outerOpacity})`,
    `0 0 ${s.midBlur}px ${s.midSpread}px rgba(${r}, ${g}, ${b}, ${s.midOpacity})`,
    `inset 0 0 ${s.insetBlur}px ${s.insetSpread}px rgba(${r}, ${g}, ${b}, ${s.insetOpacity})`,
  ].join(", ");
}
