const PREVIEW_CHARACTERS = 72;

/** `text` on one line, cut to a length that fits a list row. */
export function preview(text: string | undefined): string {
  const flat = (text ?? "").replace(/\s+/g, " ").trim();
  return flat.length > PREVIEW_CHARACTERS
    ? `${flat.slice(0, PREVIEW_CHARACTERS)}…`
    : flat;
}
