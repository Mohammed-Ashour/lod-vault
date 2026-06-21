const { defineConfig, devices } = require("@playwright/test");

// E2E config: two projects, one per browser. Chrome runs headless via Playwright's
// bundled chromium channel. Firefox runs headed (dev-mode extensions require it);
// on headless CI invoke `xvfb-run npm run test:e2e:firefox`.

module.exports = defineConfig({
  testDir: "./e2e",
  timeout: 120_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    actionTimeout: 20_000,
    navTimeout: 30_000
  },
  projects: [
    {
      name: "chrome",
      use: { ...devices["Desktop Chrome"] }
    }
  ]
});
