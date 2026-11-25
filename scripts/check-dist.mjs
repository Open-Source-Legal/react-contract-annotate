// Checks that the built entry points of `dist/` stay isolated from each
// other's engines.
//   node scripts/check-dist.mjs [distDir]      (default: ./dist; run `yarn build` first)
// Exits 1 and prints every problem found.
//
// Each entry's *static* import graph (the entry file and every chunk it
// reaches through `import … from` / `export … from`) is walked, and:
//   - `pdf/index.js` must not reach a file importing docxodus or dompurify;
//   - `docx/index.js` must not reach a file importing pdfjs-dist;
//   - `core/index.js` must reach neither;
//   - `index.js` (the dispatcher) must reach neither statically: it loads the
//     engines through dynamic `import()` only, and must do so for both.
// Further, over every `.js` file of `dist/`:
//   - none may import @apollo/client, react-router or lodash;
// and over the type declarations:
//   - each of the four entries has a `.js` and a `.d.ts`;
//   - no `.d.ts` mentions jotai (the state library is private to the package).
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const distRoot = path.resolve(
  process.argv[2] ?? fileURLToPath(new URL("../dist", import.meta.url))
);

/** Packages only one engine may use. */
const PDF_ENGINE = ["pdfjs-dist"];
const DOCX_ENGINE = ["docxodus", "dompurify"];

/** Packages of the app frameworks the library is extracted from. */
const BANNED_EVERYWHERE = [
  "@apollo/client",
  "react-router",
  "react-router-dom",
  "lodash",
  "lodash-es",
];

/** The four entries: their output (relative to dist) and what each may not reach. */
const ENTRIES = [
  { name: "core", file: "core/index.js", forbidden: [...PDF_ENGINE, ...DOCX_ENGINE] },
  { name: "pdf", file: "pdf/index.js", forbidden: DOCX_ENGINE },
  { name: "docx", file: "docx/index.js", forbidden: PDF_ENGINE },
  { name: "root", file: "index.js", forbidden: [...PDF_ENGINE, ...DOCX_ENGINE] },
];

/** What the dispatcher must load lazily. */
const LAZY_ENGINES = ["pdf/index.js", "docx/index.js"];

/** The public type declarations must not mention the private state library. */
const PRIVATE_DEPENDENCY_IN_TYPES = /jotai/i;

const problems = new Set();
const fail = (message) => problems.add(message);

const rel = (file) => path.relative(distRoot, file).split(path.sep).join("/");

/** True when `specifier` is `pkg` itself or a subpath of it. */
const isPackage = (specifier, pkg) =>
  specifier === pkg || specifier.startsWith(`${pkg}/`);

const isRelative = (specifier) =>
  specifier.startsWith("./") || specifier.startsWith("../");

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else yield full;
  }
}

const stringValue = (node) =>
  node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
    ? node.text
    : undefined;

const parsed = new Map();

/**
 * The module specifiers a built file imports: `static` ones (top-level
 * `import` / `export … from`) and `dynamic` ones (`import()`, `require()`).
 */
function importsOf(file) {
  let result = parsed.get(file);
  if (result) return result;
  const sf = ts.createSourceFile(
    file,
    readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS
  );
  result = { static: [], dynamic: [] };
  for (const statement of sf.statements) {
    if (
      (ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)) &&
      statement.moduleSpecifier
    ) {
      const specifier = stringValue(statement.moduleSpecifier);
      if (specifier !== undefined) result.static.push(specifier);
    }
  }
  const visit = (node) => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const isDynamicImport = callee.kind === ts.SyntaxKind.ImportKeyword;
      const isRequire = ts.isIdentifier(callee) && callee.text === "require";
      if (isDynamicImport || isRequire) {
        const specifier = stringValue(node.arguments[0]);
        if (specifier !== undefined) result.dynamic.push(specifier);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  parsed.set(file, result);
  return result;
}

/** The file a relative specifier of `from` names, or undefined (reported). */
function resolveRelative(from, specifier) {
  const target = path.resolve(path.dirname(from), specifier);
  if (existsSync(target)) return target;
  fail(`${rel(from)}: imports "${specifier}", which is not in dist/`);
  return undefined;
}

/**
 * Every file reachable from `entry` through static relative imports, each
 * with the chain of files that leads to it.
 */
function staticGraph(entry) {
  const chains = new Map([[entry, [entry]]]);
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.shift();
    for (const specifier of importsOf(file).static) {
      if (!isRelative(specifier)) continue;
      const target = resolveRelative(file, specifier);
      if (target && !chains.has(target)) {
        chains.set(target, [...chains.get(file), target]);
        queue.push(target);
      }
    }
  }
  return chains;
}

if (!existsSync(distRoot)) {
  console.error(`check-dist: ${distRoot} does not exist; run \`yarn build\` first`);
  process.exit(1);
}

const files = [...walk(distRoot)];

// Entries are present, with their type declarations.
for (const { name, file } of ENTRIES) {
  const js = path.join(distRoot, file);
  const dts = js.replace(/\.js$/, ".d.ts");
  if (!existsSync(js)) fail(`entry "${name}": dist/${file} is missing`);
  if (!existsSync(dts)) fail(`entry "${name}": dist/${rel(dts)} is missing`);
}

// Each entry reaches only the engine it is allowed to.
for (const { name, file, forbidden } of ENTRIES) {
  const entry = path.join(distRoot, file);
  if (!existsSync(entry)) continue;
  for (const [reached, chain] of staticGraph(entry)) {
    for (const specifier of importsOf(reached).static) {
      const banned = forbidden.find((pkg) => isPackage(specifier, pkg));
      if (banned) {
        fail(
          `entry "${name}" statically reaches "${specifier}": ` +
            `${chain.map(rel).join(" -> ")} imports it`
        );
      }
    }
  }
}

// The dispatcher loads both engines, and only dynamically.
const rootEntry = path.join(distRoot, "index.js");
if (existsSync(rootEntry)) {
  const lazy = new Set();
  for (const reached of staticGraph(rootEntry).keys()) {
    for (const specifier of importsOf(reached).dynamic) {
      if (!isRelative(specifier)) continue;
      const target = resolveRelative(reached, specifier);
      if (target) lazy.add(rel(target));
    }
  }
  for (const engine of LAZY_ENGINES) {
    if (!lazy.has(engine)) {
      fail(`entry "root" does not load dist/${engine} through a dynamic import()`);
    }
  }
}

// Nothing imports an app framework.
for (const file of files.filter((f) => f.endsWith(".js"))) {
  const { static: staticImports, dynamic } = importsOf(file);
  for (const specifier of [...staticImports, ...dynamic]) {
    const banned = BANNED_EVERYWHERE.find((pkg) => isPackage(specifier, pkg));
    if (banned) fail(`${rel(file)} imports banned package "${specifier}"`);
  }
}

// The private state library does not show in the public types.
for (const file of files.filter((f) => f.endsWith(".d.ts"))) {
  if (PRIVATE_DEPENDENCY_IN_TYPES.test(readFileSync(file, "utf8"))) {
    fail(`${rel(file)} mentions jotai, which must stay private`);
  }
}

if (problems.size > 0) {
  console.error([...problems].join("\n"));
  console.error(`\ncheck-dist failed: ${problems.size} problem(s)`);
  process.exit(1);
}
console.log(`dist OK: ${ENTRIES.length} entries`);
