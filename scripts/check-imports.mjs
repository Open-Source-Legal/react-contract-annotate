// Enforces the import and DOM-access rules of the library's source tree.
//   node scripts/check-imports.mjs [srcDir]      (default: ./src)
// Exits 1 and prints file:line:col for every violation.
//
// Rules (see "Global Constraints" in the implementation plan):
//   1. No app-framework imports (Apollo, router, lodash, ...) anywhere.
//   2. src/core and src/pdf never import docxodus or dompurify;
//      src/core and src/docx never import pdfjs-dist.
//   3. pdf.js imports come only from pdfjs-dist/legacy/build/pdf.mjs (runtime)
//      or pdfjs-dist/types/... (types).
//   4. No document.querySelector / querySelectorAll / getElementById: query
//      from the instance root element. Files under __tests__/ are exempt from
//      this rule only.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const SOURCE_EXTENSIONS = new Set([
  ".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs",
]);

const BANNED_PACKAGES = [
  "@apollo/client",
  "react-router-dom",
  "lodash",
  "lodash-es",
  "uuid",
  "lucide-react",
  "semantic-ui-react",
  "@os-legal/ui",
  "axios",
  "react-toastify",
];

const PDF_RUNTIME_ENTRY = "pdfjs-dist/legacy/build/pdf.mjs";
const PDF_TYPES_PREFIX = "pdfjs-dist/types/";

const BANNED_DOCUMENT_MEMBERS = new Set([
  "querySelector",
  "querySelectorAll",
  "getElementById",
]);

/** True when `specifier` is `pkg` itself or a subpath of it. */
const isPackage = (specifier, pkg) =>
  specifier === pkg || specifier.startsWith(`${pkg}/`);

const srcRoot = path.resolve(
  process.argv[2] ??
    fileURLToPath(new URL("../src", import.meta.url))
);

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (SOURCE_EXTENSIONS.has(path.extname(entry.name))) yield full;
  }
}

function scriptKindOf(file) {
  const ext = path.extname(file);
  if (ext === ".tsx") return ts.ScriptKind.TSX;
  if (ext === ".jsx") return ts.ScriptKind.JSX;
  if (ext === ".js" || ext === ".mjs" || ext === ".cjs") return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

const stringValue = (node) =>
  node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
    ? node.text
    : undefined;

/** Name of the member in `document.x` / `document["x"]`, else undefined. */
function documentMember(node) {
  const isDocument = (expr) =>
    (ts.isIdentifier(expr) && expr.text === "document") ||
    (ts.isPropertyAccessExpression(expr) &&
      expr.name.text === "document" &&
      ts.isIdentifier(expr.expression) &&
      (expr.expression.text === "window" || expr.expression.text === "globalThis"));
  if (ts.isPropertyAccessExpression(node) && isDocument(node.expression)) {
    return node.name.text;
  }
  if (ts.isElementAccessExpression(node) && isDocument(node.expression)) {
    return stringValue(node.argumentExpression);
  }
  return undefined;
}

function checkFile(file) {
  const rel = path.relative(srcRoot, file).split(path.sep);
  const inCore = rel[0] === "core";
  const inPdf = rel[0] === "pdf";
  const inDocx = rel[0] === "docx";
  const inTests = rel.includes("__tests__");

  const text = readFileSync(file, "utf8");
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, scriptKindOf(file));
  const violations = [];

  const report = (node, message) => {
    const { line, character } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
    violations.push(`${path.relative(process.cwd(), file)}:${line + 1}:${character + 1}  ${message}`);
  };

  const checkSpecifier = (node, specifier) => {
    for (const pkg of BANNED_PACKAGES) {
      if (isPackage(specifier, pkg)) report(node, `banned import "${specifier}"`);
    }
    if ((inCore || inPdf) && (isPackage(specifier, "docxodus") || isPackage(specifier, "dompurify"))) {
      report(node, `src/${rel[0]} must not import "${specifier}" (docx-only dependency)`);
    }
    if ((inCore || inDocx) && isPackage(specifier, "pdfjs-dist")) {
      report(node, `src/${rel[0]} must not import "${specifier}" (pdf-only dependency)`);
    }
    if (
      isPackage(specifier, "pdfjs-dist") &&
      specifier !== PDF_RUNTIME_ENTRY &&
      !specifier.startsWith(PDF_TYPES_PREFIX)
    ) {
      report(node, `pdf.js must be imported from "${PDF_RUNTIME_ENTRY}" or "${PDF_TYPES_PREFIX}…", not "${specifier}"`);
    }
  };

  const visit = (node) => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
      const specifier = stringValue(node.moduleSpecifier);
      if (specifier !== undefined) checkSpecifier(node, specifier);
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      const specifier = stringValue(node.moduleReference.expression);
      if (specifier !== undefined) checkSpecifier(node, specifier);
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
      const specifier = stringValue(node.argument.literal);
      if (specifier !== undefined) checkSpecifier(node, specifier);
    } else if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const isDynamicImport = callee.kind === ts.SyntaxKind.ImportKeyword;
      const isRequire = ts.isIdentifier(callee) && callee.text === "require";
      if (isDynamicImport || isRequire) {
        const specifier = stringValue(node.arguments[0]);
        if (specifier !== undefined) checkSpecifier(node, specifier);
      }
    }

    if (!inTests) {
      const member = documentMember(node);
      if (member !== undefined && BANNED_DOCUMENT_MEMBERS.has(member)) {
        report(node, `document.${member} is banned: query from the instance root element`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return violations;
}

const files = [...walk(srcRoot)];
const violations = files.flatMap(checkFile);

if (violations.length > 0) {
  console.error(violations.join("\n"));
  console.error(`\nlint:imports failed: ${violations.length} violation(s)`);
  process.exit(1);
}
console.log(`lint:imports OK (${files.length} files)`);
