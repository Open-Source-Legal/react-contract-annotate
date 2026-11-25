/**
 * `styled` of styled-components, however the package was loaded.
 *
 * A bundler loads styled-components' ES build, whose default export is
 * `styled`. Node itself (a test runner or a server that does not bundle its
 * dependencies) loads its CommonJS build, since the package (6.x) names no
 * ES entry Node reads: there the default import is the module's exports
 * object, and `styled` is that object's `default`. Used as it comes, it
 * fails with "styled.button is not a function" as soon as this library is
 * imported.
 */
import styledComponents from "styled-components";

type Styled = typeof styledComponents;

export const styled: Styled =
  (styledComponents as Styled & { default?: Styled }).default ??
  styledComponents;
