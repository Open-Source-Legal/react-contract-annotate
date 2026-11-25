/**
 * `value` as a quoted CSS string: backslashes and quotes escaped, line
 * breaks and other control characters as hex escapes. Every piece of
 * host- or document-supplied text in a stylesheet the DOCX format generates
 * goes through this (colours go through `safeCssColor`).
 */
export function cssString(value: string): string {
  const escaped = value
    .replace(/[\\"]/g, "\\$&")
    .replace(
      /[\u0000-\u001f\u007f]/g,
      (c) => `\\${c.charCodeAt(0).toString(16)} `
    );
  return `"${escaped}"`;
}
