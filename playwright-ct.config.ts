import { defineConfig, devices } from "@playwright/experimental-ct-react";

export default defineConfig({
  testDir: "./ct-tests",
  testMatch: "*.ct.tsx",
  reporter: "list",
  timeout: 60000,
  use: {
    ...devices["Desktop Chrome"],
    viewport: { width: 1280, height: 900 },
    ctViteConfig: {
      optimizeDeps: { exclude: ["docxodus"] },
    },
  },
});
