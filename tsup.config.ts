import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    "pdf/index": "src/pdf/index.ts",
    "docx/index": "src/docx/index.ts",
    "core/index": "src/core/index.ts",
  },
  format: ["esm"],
  splitting: true,
  dts: true,
  clean: true,
  external: [
    "react",
    "react-dom",
    "react/jsx-runtime",
    "styled-components",
    "pdfjs-dist",
    "docxodus",
    "docxodus/react",
    /^pdfjs-dist\//,
  ],
});
