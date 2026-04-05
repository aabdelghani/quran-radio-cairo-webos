const { test, expect } = require('@playwright/test');

let server;
test.beforeAll(async () => {
    const http = require('http');
    const fs = require('fs');
    const path = require('path');
    const dir = path.resolve(__dirname, '..');
    const mimeTypes = { '.html': 'text/html', '.js': 'application/javascript', '.png': 'image/png', '.mp3': 'audio/mpeg', '.json': 'application/json' };
    server = http.createServer((req, res) => {
        const filePath = path.join(dir, req.url === '/' ? 'index.html' : req.url);
        const ext = path.extname(filePath);
        fs.readFile(filePath, (err, data) => {
            if (err) { res.writeHead(404); res.end(); return; }
            res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' });
            res.end(data);
        });
    });
    await new Promise(r => server.listen(8888, r));
});

test.afterAll(async () => { if (server) server.close(); });

const APP_URL = 'http://localhost:8888';

test.describe('Quran Radio Cairo App', () => {

    test.beforeEach(async ({ page }) => {
        await page.goto(APP_URL);
        await page.waitForTimeout(6000); // wait for APIs to load
    });

    // --- UI ---
    test('app loads with title', async ({ page }) => {
        expect((await page.locator('#mainTitle').textContent()).length).toBeGreaterThan(0);
    });

    test('play button is visible', async ({ page }) => {
        await expect(page.locator('#playBtn')).toBeVisible();
    });

    test('schedule header', async ({ page }) => {
        expect(await page.locator('.schedule-header').textContent()).toBe('فقرات اليوم');
    });

    test('prayer header', async ({ page }) => {
        expect(await page.locator('.prayer-header').textContent()).toBe('مواقيت الصلاة');
    });

    test('default location القاهرة', async ({ page }) => {
        expect(await page.locator('#locationName').textContent()).toBe('القاهرة');
    });

    test('location button موقعي', async ({ page }) => {
        expect(await page.locator('#locationBtn').textContent()).toBe('موقعي');
    });

    test('disclaimer visible', async ({ page }) => {
        await expect(page.locator('text=Not affiliated')).toBeVisible();
    });

    test('version visible', async ({ page }) => {
        await expect(page.locator('text=v1.0.0')).toBeVisible();
    });

    // --- Playback ---
    test('auto-plays on launch', async ({ page }) => {
        const playing = await page.locator('#playBtn').evaluate(el => el.classList.contains('playing'));
        expect(playing).toBe(true);
    });

    test('stop works', async ({ page }) => {
        await page.locator('#playBtn').click();
        await page.waitForTimeout(500);
        expect(await page.locator('#status').textContent()).toBe('Press to play');
    });

    test('play/stop toggle', async ({ page }) => {
        await page.locator('#playBtn').click();
        await page.waitForTimeout(500);
        expect(await page.locator('#status').textContent()).toBe('Press to play');
        await page.locator('#playBtn').click();
        await page.waitForTimeout(2000);
        expect(['Connecting...', 'Buffering...', 'Live']).toContain(await page.locator('#status').textContent());
    });

    test('Enter key toggles', async ({ page }) => {
        await page.locator('#playBtn').click();
        await page.waitForTimeout(500);
        expect(await page.locator('#status').textContent()).toBe('Press to play');
        await page.locator('#playBtn').focus();
        await page.keyboard.press('Enter');
        await page.waitForTimeout(2000);
        expect(['Connecting...', 'Buffering...', 'Live']).toContain(await page.locator('#status').textContent());
    });

    // --- Schedule ---
    test('schedule loads', async ({ page }) => {
        expect(await page.locator('.schedule-item').count()).toBeGreaterThan(0);
    });

    test('at most one active program', async ({ page }) => {
        expect(await page.locator('.schedule-item.active').count()).toBeLessThanOrEqual(1);
    });

    // --- Prayer ---
    test('6 prayer items', async ({ page }) => {
        expect(await page.locator('.prayer-item').count()).toBe(6);
    });

    test('prayer time format', async ({ page }) => {
        expect(await page.locator('.prayer-time-val').first().textContent()).toMatch(/\d{1,2}:\d{2}\s*(AM|PM)/);
    });

    test('next prayer highlighted', async ({ page }) => {
        expect(await page.locator('.prayer-item.next').count()).toBe(1);
    });

    test('hijri date', async ({ page }) => {
        const hijri = await page.locator('#hijriDate').textContent();
        expect(hijri).toContain('هـ');
    });

    // --- Clock ---
    test('clock ticks', async ({ page }) => {
        const t1 = await page.locator('#currentTimeDisplay').textContent();
        await page.waitForTimeout(2000);
        expect(await page.locator('#currentTimeDisplay').textContent()).not.toBe(t1);
    });

    test('next salah countdown', async ({ page }) => {
        const text = await page.locator('#nextSalahDisplay').textContent();
        expect(text).toContain('صلاة');
        expect(text).toContain('بعد');
    });
});
