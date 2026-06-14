import { defineConfig, devices } from '@playwright/test';

// Blissful project-wide E2E (see e2e/README.md).
//
// Projects map to PLATFORMS — run one with `--project web|desktop|android`, or all:
//   web      — the dev UI (vite) driven by Playwright's chromium
//   desktop  — the real Rust shell over a CDP debug port (custom fixture, no browser)
//   android  — the TV app over adb + CDP on the WebView (custom fixture; auto-skips
//              unless a device/emulator is connected)
//
// Suites live in e2e/suites/*.<platform>.spec.ts. Artifacts go to .tmp-e2e/ (gitignored).
export default defineConfig({
  testDir: './e2e/suites',
  // Shared singletons (the shell binary lock, stremio :11470, prod watch-party rooms)
  // make blind parallelism unsafe; opt individual suites into parallel where safe.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: [['list'], ['html', { open: 'never', outputFolder: '.tmp-e2e/report' }]],
  outputDir: '.tmp-e2e/results',
  use: { trace: 'on-first-retry', screenshot: 'only-on-failure' },
  // Dev UI for the web (and desktop, pointed at it) projects — reused if already up.
  webServer: {
    command: 'npm --prefix apps/web-blissful run dev -- --port 5173 --strictPort',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    timeout: 120_000,
  },
  projects: [
    {
      name: 'web',
      testMatch: /.*\.web\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        baseURL: 'http://localhost:5173',
        // Player suites need autoplay without a user gesture.
        launchOptions: { args: ['--autoplay-policy=no-user-gesture-required'] },
      },
    },
    {
      name: 'desktop',
      testMatch: /.*\.desktop\.spec\.ts/,
      // The desktop fixture launches the Rust shell + connects over CDP (no Playwright browser).
    },
    {
      name: 'android',
      testMatch: /.*\.android\.spec\.ts/,
      // adb keyevents + CDP over the TV WebView; the fixture skips when no device is attached.
    },
    {
      name: 'protocol',
      testMatch: /.*\.protocol\.spec\.ts/,
      // Raw ws/http wire-protocol tests against the deployed backend — no browser, no shell.
    },
  ],
});
