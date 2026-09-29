import { expect, test } from '@playwright/test';
import { assertNoRuntimeErrors, closeFixture, launchFixture, type E2eFixture } from './fixture';

/** Minimal typing for main-process evaluation (the Electron module types are not a test dependency). */
interface MainProcess {
  readonly BrowserWindow: {
    getAllWindows(): readonly {
      readonly webContents: {
        getLastWebPreferences(): { sandbox?: boolean; contextIsolation?: boolean; nodeIntegration?: boolean; webviewTag?: boolean } | null;
        getURL(): string;
        executeJavaScript(code: string): Promise<unknown>;
      };
    }[];
  };
}

let fixture!: E2eFixture;
let launched = false;

test.beforeEach(async () => {
  fixture = await launchFixture('security', {
    'Hostile.md': '# Hostile\n\nzebra <img src=x onerror="document.title=\'pwned\'"> <b>zebra</b> [external](https://example.com/away)\n',
  });
  launched = true;
});
test.afterEach(async () => { if (launched) { assertNoRuntimeErrors(fixture); await closeFixture(fixture); } launched = false; });

test('Electron security invariants hold for Tier 1 surfaces', async () => {
  const { app, page } = fixture;
  const preferences = await app.evaluate((electron: unknown) => {
    const { BrowserWindow } = electron as MainProcess;
    const prefs = BrowserWindow.getAllWindows()[0]!.webContents.getLastWebPreferences();
    return { sandbox: prefs?.sandbox, contextIsolation: prefs?.contextIsolation, nodeIntegration: prefs?.nodeIntegration, webviewTag: prefs?.webviewTag };
  });
  expect(preferences).toEqual({ sandbox: true, contextIsolation: true, nodeIntegration: false, webviewTag: false });

  const renderer = await page.evaluate(() => ({
    process: typeof (globalThis as Record<string, unknown>)['process'],
    require: typeof (globalThis as Record<string, unknown>)['require'],
    bridgeKeys: Object.keys((window as unknown as { knowledgeStudio: Record<string, unknown> }).knowledgeStudio),
    opened: window.open('https://example.com/popup') === null,
  }));
  expect(renderer).toMatchObject({ process: 'undefined', require: 'undefined', opened: true });
  expect(renderer.bridgeKeys).not.toContain('invoke');
  expect(renderer.bridgeKeys.some((key) => /ipc|send|exec|shell|eval/i.test(key))).toBe(false);
  expect(app.windows()).toHaveLength(1);

  // Search snippets from hostile note text render as text, not HTML.
  await page.keyboard.press('Control+P');
  await page.getByPlaceholder('Search the vault…').fill('zebra');
  const snippet = page.locator('.search-overlay__hit-snippet').first();
  await expect(snippet).toContainText('<img src=x');
  await expect(snippet.locator('img, b')).toHaveCount(0);
  await expect(snippet.locator('mark').first()).toHaveText('zebra');
  await page.keyboard.press('Enter');
  expect(await page.title()).not.toBe('pwned');

  // Renderer cannot reach the loopback MCP server even when it is running (CSP + Origin guard).
  await page.locator('.mcp-panel').getByRole('button', { name: 'Start local MCP' }).click();
  const bind = page.locator('.mcp-panel').getByText(/Bind: http:\/\/127\.0\.0\.1:\d+/);
  await expect(bind).toBeVisible();
  const endpoint = /http:\/\/127\.0\.0\.1:\d+/.exec(await bind.innerText())![0];
  const blocked = await page.evaluate(async (url) => {
    try { await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"method":"tools/list"}' }); return false; } catch { return true; }
  }, endpoint);
  expect(blocked).toBe(true);
  fixture.consoleErrors.splice(0); // the CSP violation for that deliberate probe is expected
  await page.locator('.mcp-panel').getByRole('button', { name: 'Stop MCP' }).click();

  // Links from note content cannot navigate the app window away.
  const before = page.url();
  await page.getByRole('button', { name: 'preview' }).click();
  // Raw mouse click: locator.click() would wait for a navigation that is (correctly) never allowed.
  const box = await page.locator('.preview a[href="https://example.com/away"]').boundingBox();
  if (!box) throw new Error('link has no box');
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  // Verify from the main process: Playwright's page model may consider the vetoed navigation pending.
  await new Promise((resolve) => setTimeout(resolve, 500));
  const after = await app.evaluate(async (electron: unknown) => {
    const { BrowserWindow } = electron as MainProcess;
    const contents = BrowserWindow.getAllWindows()[0]!.webContents;
    return { url: contents.getURL(), workbench: (await contents.executeJavaScript('Boolean(document.querySelector(".workbench"))')) === true, windows: BrowserWindow.getAllWindows().length };
  });
  expect(after).toEqual({ url: before, workbench: true, windows: 1 });
});
