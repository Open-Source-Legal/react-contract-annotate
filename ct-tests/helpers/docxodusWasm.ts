/**
 * Serves docxodus' WebAssembly runtime to the component-test page. Ported
 * from OpenContracts' `tests/utils/docxodusWasm.ts` (98286cabf).
 *
 * The test bundle moves docxodus' JS away from its sibling `wasm/` folder, so
 * docxodus cannot find the runtime by itself: the harness passes
 * `wasmBaseUrl={DOCXODUS_WASM_URL}` and this route answers every request
 * under it from `node_modules/docxodus/dist/wasm` (resolved against the test
 * process's working directory, the repo root, as `serveFixtures` does).
 *
 * Changed from OpenContracts: the directory is relative to the working
 * directory (this module is ESM, so there is no `__dirname`), and a request
 * for a file that is not there is answered 404 rather than passed on.
 */
import type { Page } from "@playwright/test";

/** Where the harness tells docxodus its runtime is served. */
export const DOCXODUS_WASM_URL = "/docxodus-wasm/";

const WASM_DIR = "node_modules/docxodus/dist/wasm";

const MIME_TYPES: Record<string, string> = {
  js: "application/javascript",
  wasm: "application/wasm",
  json: "application/json",
  dat: "application/octet-stream",
};

/** Must be called before mounting anything that initialises docxodus. */
export async function setupDocxodusWasm(page: Page): Promise<void> {
  await page.route(`**${DOCXODUS_WASM_URL}**`, async (route) => {
    const { pathname } = new URL(route.request().url());
    const relative = decodeURIComponent(
      pathname.slice(
        pathname.indexOf(DOCXODUS_WASM_URL) + DOCXODUS_WASM_URL.length
      )
    );
    if (relative === "" || relative.split("/").includes("..")) {
      await route.fulfill({ status: 404 });
      return;
    }
    const extension = relative.slice(relative.lastIndexOf(".") + 1);
    try {
      await route.fulfill({
        path: `${WASM_DIR}/${relative}`,
        contentType: MIME_TYPES[extension] ?? "application/octet-stream",
      });
    } catch {
      // No such file.
      await route.fulfill({ status: 404 });
    }
  });
}
