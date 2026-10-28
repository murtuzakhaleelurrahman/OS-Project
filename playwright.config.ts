import { defineConfig, devices } from '@playwright/test'

const deployedBase = process.env.PLAYWRIGHT_BASE_URL

// A dedicated production preview avoids changing the user's development session.
export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  timeout: 30_000,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: deployedBase ?? 'http://127.0.0.1:4174/OS-Project/',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: deployedBase ? undefined : {
    command: 'npm run build:pages && npm run preview -- --base=/OS-Project/ --host 127.0.0.1 --port 4174 --strictPort',
    url: 'http://127.0.0.1:4174/OS-Project/',
    reuseExistingServer: false,
    timeout: 120_000,
  },
})
