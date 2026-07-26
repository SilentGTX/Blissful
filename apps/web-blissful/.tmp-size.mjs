import { chromium } from '@playwright/test';
const b = await chromium.launch();
const page = await b.newPage({ viewport: { width: 1870, height: 1008 } });
await page.addInitScript(() => localStorage.setItem('uiStyle', 'tv'));
await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(3000);
const probe = () => page.evaluate(() => {
  const el = document.querySelector('.bliss-sidebar nav .nav-icon-slot svg');
  const r = el.getBoundingClientRect();
  return { size: Math.round(r.width), cx: +(r.left + r.width / 2).toFixed(1) };
});
console.log('collapsed:', JSON.stringify(await probe()));
await page.getByLabel('Expand sidebar').click();
await page.waitForTimeout(1200);
console.log('expanded :', JSON.stringify(await probe()));
await b.close();
