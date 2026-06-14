import { test, expect } from '@playwright/test';

// Foundation smoke: the dev UI boots and the React app mounts. Validates the
// `web` project + the vite webServer wiring that every web suite builds on.
// Not a feature test — just "the harness can drive the real web app."
test('web app boots and mounts', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle(/Blissful/);
  await page.waitForFunction(
    () => (document.querySelector('#root')?.children.length ?? 0) > 0,
    null,
    { timeout: 30_000 },
  );
  const mountedChildren = await page.evaluate(
    () => document.querySelector('#root')!.children.length,
  );
  expect(mountedChildren).toBeGreaterThan(0);
});
