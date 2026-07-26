import { test, expect, type Page } from '@playwright/test';

// Home + browse (web). Asserts STRUCTURE on the real home / search / discover
// pages, using a search term guaranteed to have Cinemeta results ('Batman').
// Content is live — we assert that the hero / rows / grid RENDER, not specific titles.
//
// Classic and TV share the same page bodies (hero card + poster rails); the TV
// theme is a chrome reskin of the old Tauri TV app — icon-only rail, pill
// search, accent-filled primary action. So the body assertions run for both and
// the theme-specific ones cover the chrome.

/** Boot the app with a given uiStyle, the way the Settings page persists it. */
async function useTheme(page: Page, theme: 'classic' | 'tv') {
  await page.addInitScript((t) => localStorage.setItem('uiStyle', t), theme);
}

test.describe('Home + browse (web)', () => {
  for (const theme of ['classic', 'tv'] as const) {
    test(`${theme} home renders the hero, search bar, and media rails`, async ({ page }) => {
      await useTheme(page, theme);
      await page.goto('/');
      // The TV theme uses the old TV app's wording for the search placeholder.
      const placeholder = theme === 'tv' ? 'Search movies, series, actors...' : 'Search everything';
      await expect(page.getByPlaceholder(placeholder)).toBeVisible({ timeout: 20_000 });
      await expect(page.getByTestId('home-hero-card')).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId('media-rail').first()).toBeVisible({ timeout: 30_000 });
    });
  }

  test('search submits and navigates to the search page with results', async ({ page }) => {
    await page.goto('/');
    const search = page.getByPlaceholder('Search everything');
    await search.fill('Batman');
    await search.press('Enter');
    await page.waitForURL(/\/search/, { timeout: 15_000 });
    await expect(page.getByTestId('media-rail').first()).toBeVisible({ timeout: 30_000 });
  });

  test('discover renders the catalog grid', async ({ page }) => {
    await page.goto('/discover');
    await expect(page.getByTestId('discover-grid')).toBeVisible({ timeout: 30_000 });
  });
});

// The two themes differ only in chrome, which makes them easy to cross-wire:
// a rule that forgets its html[data-ui="tv"] scope silently restyles Classic.
// These assert the signals that actually distinguish them.
test.describe('Theme chrome is scoped', () => {
  test('tv fills the hero primary with the accent; classic keeps it white', async ({ page }) => {
    const fillOf = async (theme: 'classic' | 'tv') => {
      await useTheme(page, theme);
      await page.goto('/');
      const btn = page.getByRole('button', { name: 'Watch now' }).first();
      await expect(btn).toBeVisible({ timeout: 30_000 });
      return btn.evaluate((el) => getComputedStyle(el).backgroundColor);
    };
    // Accent is user-configurable, so assert "not white" rather than a literal.
    const tv = await fillOf('tv');
    expect(tv).not.toBe('rgb(255, 255, 255)');
    const classic = await fillOf('classic');
    expect(classic).toBe('rgb(255, 255, 255)');
  });

  test('tv collapses the rail to icons; classic leaves it expanded', async ({ page }) => {
    await useTheme(page, 'tv');
    await page.goto('/');
    await expect(page.locator('.bliss-sidebar.closed')).toHaveCount(1, { timeout: 20_000 });

    await useTheme(page, 'classic');
    await page.goto('/');
    await expect(page.getByTestId('home-hero-card')).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('.bliss-sidebar.closed')).toHaveCount(0);
  });
});

// The TV theme widens the COLLAPSED rail. A first attempt pinned the width via
// an !important custom property, which also applied while expanded — the labels
// and the Friends / Continue Watching panels were then crushed into a 160px
// column, i.e. "the sidebar is not working". Guard the round-trip.
test('tv rail expands and re-collapses', async ({ page }) => {
  await useTheme(page, 'tv');
  await page.goto('/');
  const rail = page.locator('.bliss-rail-panel');
  await expect(rail).toBeVisible({ timeout: 20_000 });
  const widthOf = async () => Math.round((await rail.boundingBox())!.width);

  const collapsed = await widthOf();
  await page.getByLabel('Expand sidebar').click();
  await expect(page.getByText('Discover', { exact: true }).first()).toBeVisible({ timeout: 10_000 });
  // The rail animates its width over ~340ms, so poll rather than sampling once.
  await expect
    .poll(widthOf, { timeout: 5_000, message: 'expanding must actually widen the rail' })
    .toBeGreaterThan(collapsed + 80);

  const expanded = await widthOf();
  await page.getByLabel('Collapse sidebar').click();
  // Assert it returns to "narrow" rather than to an exact px baseline — the
  // baseline can be sampled mid-animation and is scrollbar-sensitive.
  await expect.poll(widthOf, { timeout: 5_000 }).toBeLessThan(expanded - 80);
});

// Regressed three times by hand-tuning: icons drifted left of centre, and fixed
// row heights overflowed the rail on shorter windows so the bottom glyph got
// clipped. Assert both, at several heights.
for (const [w, h] of [[1870, 1008], [1280, 720]] as const) {
  test(`tv rail: icons centred and unclipped at ${w}x${h}`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: h });
    await useTheme(page, 'tv');
    await page.goto('/');
    await expect(page.locator('.bliss-rail-panel')).toBeVisible({ timeout: 20_000 });
    const r = await page.evaluate(() => {
      const p = document.querySelector('.bliss-rail-panel')!.getBoundingClientRect();
      const cx = p.left + p.width / 2;
      const g = [...document.querySelectorAll('.bliss-sidebar .nav-icon-slot svg')].map((el) => {
        const b = el.getBoundingClientRect();
        return { off: Math.abs(b.left + b.width / 2 - cx), over: b.bottom - p.bottom };
      });
      return { count: g.length, maxOff: Math.max(...g.map((x) => x.off)), maxOver: Math.max(...g.map((x) => x.over)) };
    });
    expect(r.count).toBeGreaterThan(3);
    expect(r.maxOff, 'glyphs must sit on the rail centre line').toBeLessThanOrEqual(2);
    expect(r.maxOver, 'no glyph may spill past the rail').toBeLessThanOrEqual(0);
  });
}

// Collapse/expand must animate the WIDTH while the glyphs stand still, as
// Classic does. That only holds if the icon slot is exactly as wide as the
// collapsed row's content AND the rail's padding is identical in both states —
// scoping either to the collapsed state alone reintroduces a visible jump.
test('tv rail: icons do not move while the rail animates', async ({ page }) => {
  await useTheme(page, 'tv');
  await page.goto('/');
  await expect(page.locator('.bliss-rail-panel')).toBeVisible({ timeout: 20_000 });
  const iconCx = () =>
    page.evaluate(() => {
      const b = document.querySelector('.bliss-sidebar nav .nav-icon-slot svg')!.getBoundingClientRect();
      return +(b.left + b.width / 2).toFixed(1);
    });

  const glyph = () =>
    page.evaluate(() =>
      Math.round(
        document.querySelector('.bliss-sidebar nav .nav-icon-slot svg')!.getBoundingClientRect().width,
      ),
    );

  const collapsed = await iconCx();
  const collapsedSize = await glyph();
  await page.getByLabel('Expand sidebar').click();
  await page.waitForTimeout(120); // mid-transition
  expect(Math.abs((await iconCx()) - collapsed), 'glyph must not travel mid-animation').toBeLessThanOrEqual(1);
  await expect(page.getByText('Discover', { exact: true }).first()).toBeVisible({ timeout: 10_000 });
  await page.waitForTimeout(600);
  expect(Math.abs((await iconCx()) - collapsed), 'glyph must not travel when expanded').toBeLessThanOrEqual(1);
  // Size must hold too: scoping the size rule to .closed snapped the glyphs
  // from ~50px down to the base ~20px on expand, and once they were unscoped
  // the base row height was too short and they overlapped each other.
  expect(await glyph(), 'glyph must not resize when expanded').toBe(collapsedSize);
  const overlap = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('.bliss-sidebar nav .bliss-sidebar-link')].map((el) =>
      el.getBoundingClientRect(),
    );
    let worst = 0;
    for (let i = 1; i < rows.length; i++) worst = Math.max(worst, rows[i - 1].bottom - rows[i].top);
    return Math.round(worst);
  });
  expect(overlap, 'expanded rows must not overlap').toBeLessThanOrEqual(1);
});
