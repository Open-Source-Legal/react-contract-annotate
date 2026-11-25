import { expect, test } from "@playwright/experimental-ct-react";

import { serveFixtures } from "./helpers/fixtures";

test("serveFixtures serves files under fixtures/", async ({ page }) => {
  await serveFixtures(page);
  const result = await page.evaluate(async () => {
    const relations = await fetch("/fixtures/eton/relations.json");
    const pdf = await fetch("/fixtures/eton/eton-agreement.pdf");
    const escaped = await fetch("/fixtures/..%2fpackage.json");
    return {
      relationsStatus: relations.status,
      relations: await relations.json(),
      pdfStatus: pdf.status,
      pdfMagic: new TextDecoder().decode((await pdf.arrayBuffer()).slice(0, 4)),
      escapedStatus: escaped.status,
    };
  });
  expect(result.relationsStatus).toBe(200);
  expect(result.relations[0].id).toBe("r-1");
  expect(result.pdfStatus).toBe(200);
  expect(result.pdfMagic).toBe("%PDF");
  expect(result.escapedStatus).toBe(404);
});
