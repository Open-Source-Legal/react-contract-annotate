import { createReadStream, cpSync, existsSync, statSync } from "node:fs";
import type { ServerResponse } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import type { Plugin } from "vite";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../..");

/** Directories served next to the app, by URL prefix. */
const STATIC_DIRS = {
  // The library's fixtures: the eton PDF with its PAWLS and annotations, and
  // the DOCX with its text and annotations.
  "/fixtures/": path.join(repoRoot, "fixtures"),
  // docxodus' WebAssembly runtime, which the DOCX viewer fetches at run time
  // (`wasmBaseUrl`).
  "/docxodus-wasm/": path.join(here, "node_modules/docxodus/dist/wasm"),
} as const;

const CONTENT_TYPES: Record<string, string> = {
  ".json": "application/json",
  ".pdf": "application/pdf",
  ".docx":
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".txt": "text/plain; charset=utf-8",
  ".js": "application/javascript",
  ".wasm": "application/wasm",
  ".dat": "application/octet-stream",
};

/** Serves `STATIC_DIRS` in the dev and preview servers and copies them into the build. */
function staticDirs(): Plugin {
  const serve = (
    url: string | undefined,
    res: ServerResponse,
    next: () => void
  ) => {
    const pathname = decodeURIComponent((url ?? "").split("?")[0]);
    for (const [prefix, dir] of Object.entries(STATIC_DIRS)) {
      if (!pathname.startsWith(prefix)) continue;
      const file = path.join(dir, pathname.slice(prefix.length));
      if (
        !file.startsWith(dir + path.sep) ||
        !existsSync(file) ||
        !statSync(file).isFile()
      ) {
        res.statusCode = 404;
        res.end();
        return;
      }
      res.setHeader(
        "Content-Type",
        CONTENT_TYPES[path.extname(file)] ?? "application/octet-stream"
      );
      createReadStream(file).pipe(res);
      return;
    }
    next();
  };

  let outDir = "";
  let building = false;
  return {
    name: "demo-static-dirs",
    configResolved(config) {
      outDir = path.resolve(config.root, config.build.outDir);
      building = config.command === "build";
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => serve(req.url, res, next));
    },
    configurePreviewServer(server) {
      server.middlewares.use((req, res, next) => serve(req.url, res, next));
    },
    closeBundle() {
      // Also called when the dev server closes.
      if (!building) return;
      for (const [prefix, dir] of Object.entries(STATIC_DIRS)) {
        cpSync(dir, path.join(outDir, prefix), { recursive: true });
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), staticDirs()],
  resolve: {
    // The library is linked from the repo root, whose own node_modules hold
    // another copy of each of these: one copy of each must serve the demo and
    // the library alike (two Reacts break hooks; two pdf.js builds split the
    // worker configuration).
    dedupe: [
      "react",
      "react-dom",
      "styled-components",
      "pdfjs-dist",
      "docxodus",
    ],
  },
  server: { fs: { allow: [repoRoot] } },
});
