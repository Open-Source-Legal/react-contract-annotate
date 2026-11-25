import type { Page } from "@playwright/test";

const FIXTURES_URL_SEGMENT = "/fixtures/";

/**
 * Serves every request whose URL path contains `/fixtures/` from the repo's
 * `fixtures/` directory (resolved against the test process's working
 * directory, i.e. the repo root).
 */
export async function serveFixtures(page: Page): Promise<void> {
  await page.route("**/fixtures/**", async (route) => {
    const { pathname } = new URL(route.request().url());
    const relative = decodeURIComponent(
      pathname.slice(
        pathname.indexOf(FIXTURES_URL_SEGMENT) + FIXTURES_URL_SEGMENT.length
      )
    );
    if (relative.split("/").includes("..")) {
      await route.fulfill({ status: 404 });
      return;
    }
    await route.fulfill({ path: `fixtures/${relative}` });
  });
}

/**
 * A JSON fixture, e.g. `fetchFixture(page, "eton/annotations.json")`, fetched
 * in the page (so `serveFixtures` must have been called).
 */
export function fetchFixture<T>(page: Page, relative: string): Promise<T> {
  return page.evaluate(async (path) => {
    const response = await fetch(path);
    if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
    return response.json();
  }, `${FIXTURES_URL_SEGMENT}${relative}`) as Promise<T>;
}
