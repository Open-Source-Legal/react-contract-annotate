/**
 * A `CssParser` for unit tests. jsdom parses style sheets only in its main
 * document (not in a detached one, which is what the library uses in a
 * browser), so the CSS is parsed there, in a `<style media="not all">` that
 * never applies and is removed at once. jsdom's parser is weaker than a
 * browser's: these tests check structure; the security tests run in
 * Chromium (`ct-tests/docx.ct.tsx`).
 */
import type { CssParser } from "../isolation";

export const parseInJsdom: CssParser = (css) => {
  const style = document.createElement("style");
  style.media = "not all";
  style.textContent = css;
  document.head.append(style);
  const rules = style.sheet ? Array.from(style.sheet.cssRules) : null;
  style.remove();
  return rules;
};
