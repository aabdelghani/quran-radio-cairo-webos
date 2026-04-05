const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
    testDir: './tests',
    timeout: 30000,
    use: {
        browserName: 'chromium',
        viewport: { width: 1920, height: 1080 },
        headless: true,
    },
});
