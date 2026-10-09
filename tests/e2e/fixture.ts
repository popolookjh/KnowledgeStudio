import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test';

export interface E2eFixture {
  readonly root: string;
  readonly vault: string;
  readonly userData: string;
  readonly app: ElectronApplication;
  readonly page: Page;
  readonly runtimeErrors: string[];
  readonly consoleErrors: string[];
  readonly externalRequests: string[];
  readonly launchMode: 'development' | 'packaged';
}

const TEMP_ROOT = path.resolve(process.cwd(), 'tests/e2e/.tmp');

export async function launchFixture(
  name: string,
  extraFiles: Readonly<Record<string, string | Buffer>> = {},
): Promise<E2eFixture> {
  const root = path.join(TEMP_ROOT, `${name}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  const vault = path.join(root, 'vault');
  const userData = path.join(root, 'user-data');
  try {
    await fs.mkdir(path.join(userData, 'plugins', 'example-safe'), { recursive: true });
    await fs.mkdir(vault, { recursive: true });
    await fs.writeFile(
      path.join(vault, 'Smoke.md'),
      '# Smoke Note\n\nCurrent changed content.\n',
      'utf8',
    );
    await fs.writeFile(
      path.join(vault, 'Second.md'),
      '# Second Note\n\n[[Smoke]]\n\n#persian فارسی\n',
      'utf8',
    );
    await createFixtureGitRepository(vault);
    for (const [relative, content] of Object.entries(extraFiles)) {
      await fs.mkdir(path.dirname(path.join(vault, relative)), { recursive: true });
      await fs.writeFile(path.join(vault, relative), content);
    }
    await createHistoryFixture(vault);
    await fs.writeFile(
      path.join(userData, 'knowledge-studio.json'),
      JSON.stringify({ lastVaultPath: vault }),
      'utf8',
    );
    await fs.writeFile(
      path.join(userData, 'workspace.json'),
      JSON.stringify({
        selectedVault: vault,
        openTabs: ['Smoke.md'],
        activePath: 'Smoke.md',
        editorMode: 'edit',
        explorerWidth: 240,
        rightbarWidth: 260,
        windowWidth: 1280,
        windowHeight: 800,
      }),
      'utf8',
    );
    await fs.writeFile(
      path.join(userData, 'plugins', 'example-safe', 'manifest.json'),
      JSON.stringify({
        id: 'example.safe',
        name: 'Example Safe',
        version: '1.0.0',
        description: 'E2E local manifest',
        trusted: true,
        permissions: ['VAULT_READ', 'SECRETS'],
      }),
      'utf8',
    );
    await fs.writeFile(
      path.join(userData, 'ai-providers.json'),
      JSON.stringify({
        version: 1,
        providers: [
          {
            id: 'local.echo',
            displayName: 'Local Echo',
            kind: 'local',
            enabled: false,
            semanticSearchEnabled: false,
            sendsVaultContent: false,
            disclosureConfirmed: false,
            hasSecret: false,
          },
        ],
      }),
      'utf8',
    );
    return await launchAt(root, vault, userData);
  } catch (error) {
    await removeFixtureDirectory(root);
    throw error;
  }
}

export async function restartFixture(fixture: E2eFixture): Promise<E2eFixture> {
  const { root, vault, userData } = fixture;
  await fixture.app.close();
  return launchAt(root, vault, userData);
}

async function launchAt(root: string, vault: string, userData: string): Promise<E2eFixture> {
  const packagedExecutable = process.env['ELECTRON_E2E_EXECUTABLE'];
  const launchMode = packagedExecutable ? 'packaged' : 'development';
  const desktop = path.resolve(process.cwd(), 'apps/desktop');
  const executablePath = packagedExecutable
    ? path.resolve(process.cwd(), packagedExecutable)
    : path.join(desktop, 'node_modules', 'electron', 'dist', 'electron.exe');
  await fs.access(executablePath);
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env))
    if (value !== undefined && key !== 'VITE_DEV_SERVER_URL') env[key] = value;
  const app = await electron.launch({
    executablePath,
    args: [`--user-data-dir=${userData}`, ...(launchMode === 'development' ? [desktop] : [])],
    env,
  });
  try {
    const page = await app.firstWindow();
    const runtimeErrors: string[] = [];
    const consoleErrors: string[] = [];
    const externalRequests: string[] = [];
    page.on('pageerror', (error) => runtimeErrors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });
    await page.route('**/*', async (route) => {
      const url = route.request().url();
      try {
        const parsed = new URL(url);
        if (
          (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
          !['127.0.0.1', '::1', 'localhost'].includes(parsed.hostname)
        ) {
          externalRequests.push(url);
          await route.abort();
          return;
        }
      } catch {
        // Non-network schemes, including packaged file://, are allowed.
      }
      await route.continue();
    });
    await page.waitForSelector('.workbench');
    return {
      root,
      vault,
      userData,
      app,
      page,
      runtimeErrors,
      consoleErrors,
      externalRequests,
      launchMode,
    };
  } catch (error) {
    await app.close().catch(() => undefined);
    await removeFixtureDirectory(root);
    throw error;
  }
}

export async function waitForWorkspaceTab(userData: string, tabPath: string): Promise<boolean> {
  const workspace = path.join(userData, 'workspace.json');
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const raw = await fs.readFile(workspace, 'utf8').catch(() => null);
    if (raw !== null) {
      try {
        const parsed = JSON.parse(raw) as { openTabs?: unknown };
        if (Array.isArray(parsed.openTabs) && parsed.openTabs.includes(tabPath)) return true;
      } catch {
        // The atomic settings write may be between rename steps; retry.
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return false;
}

export async function waitForCanvasZoom(vault: string): Promise<number> {
  const canvas = path.join(vault, 'boards', 'main.ks-canvas.json');
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const raw = await fs.readFile(canvas, 'utf8').catch(() => null);
    if (raw !== null) {
      try {
        const parsed: unknown = JSON.parse(raw);
        if (typeof parsed === 'object' && parsed !== null) {
          const viewport = (parsed as Record<string, unknown>)['viewport'];
          if (typeof viewport === 'object' && viewport !== null) {
            const zoom = (viewport as Record<string, unknown>)['zoom'];
            if (typeof zoom === 'number') return zoom;
          }
        }
      } catch {
        // Atomic write can be between file replacement steps; retry.
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return 0;
}

/** Polls a vault file until it satisfies the predicate (atomic writes may be mid-rename). */
export async function waitForFile(
  file: string,
  predicate: (content: string) => boolean,
): Promise<string | null> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const raw = await fs.readFile(file, 'utf8').catch(() => null);
    if (raw !== null && predicate(raw)) return raw;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return null;
}

/** Builds a small valid multi-page text PDF (standard Helvetica font) for reader tests. */
export function createTextPdf(title: string, pages: readonly string[]): Buffer {
  const escape = (text: string): string => text.replace(/[\\()]/g, (character) => `\\${character}`);
  const objects: string[] = [];
  const pageIds = pages.map((_page, index) => 4 + index * 2);
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`;
  objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
  pages.forEach((text, index) => {
    const id = pageIds[index]!;
    const stream = `BT /F1 18 Tf 40 120 Td (${escape(text)}) Tj ET`;
    objects[id] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 420 200] /Contents ${id + 1} 0 R /Resources << /Font << /F1 3 0 R >> >> >>`;
    objects[id + 1] = [`<< /Length ${stream.length} >>`, 'stream', stream, 'endstream'].join('\n');
  });
  const infoId = objects.length;
  objects[infoId] = `<< /Title (${escape(title)}) >>`;
  let body = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (let id = 1; id < objects.length; id += 1) {
    offsets[id] = Buffer.byteLength(body, 'latin1');
    body += [`${id} 0 obj`, objects[id]!, 'endobj', ''].join('\n');
  }
  const xref = Buffer.byteLength(body, 'latin1');
  const entries = offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`)
    .join('');
  body += `xref\n0 ${objects.length}\n0000000000 65535 f \n${entries}trailer\n<< /Size ${objects.length} /Root 1 0 R /Info ${infoId} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, 'latin1');
}

export async function closeFixture(fixture: E2eFixture): Promise<void> {
  await fixture.app.close().catch(() => undefined);
  await removeFixtureDirectory(fixture.root);
}

export function assertNoRuntimeErrors(fixture: E2eFixture): void {
  if (
    fixture.runtimeErrors.length > 0 ||
    fixture.consoleErrors.length > 0 ||
    fixture.externalRequests.length > 0
  ) {
    throw new Error(
      `Renderer errors: ${[...fixture.runtimeErrors, ...fixture.consoleErrors, ...fixture.externalRequests].join('\n')}`,
    );
  }
}

async function removeFixtureDirectory(root: string): Promise<void> {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      await fs.rm(root, { recursive: true, force: true });
      return;
    } catch (error) {
      if (attempt === 7) throw error;
      await new Promise((resolve) => setTimeout(resolve, 150 * (attempt + 1)));
    }
  }
}

async function createFixtureGitRepository(vault: string): Promise<void> {
  await fs.writeFile(
    path.join(vault, 'Smoke.md'),
    '# Smoke Note\n\nOriginal revision content.\n',
    'utf8',
  );
  await runGit(vault, ['init', '-q']);
  await runGit(vault, ['config', 'user.email', 'e2e@example.test']);
  await runGit(vault, ['config', 'user.name', 'E2E']);
  await runGit(vault, ['add', 'Smoke.md', 'Second.md']);
  await runGit(vault, ['commit', '-qm', 'initial']);
  await fs.writeFile(
    path.join(vault, 'Smoke.md'),
    '# Smoke Note\n\nCurrent changed content.\n',
    'utf8',
  );
}

async function createHistoryFixture(vault: string): Promise<void> {
  const id = '2026-09-04T00-00-00-000Z-smoke000001';
  const dir = path.join(vault, '.knowledge-studio', 'history', encodeURIComponent('Smoke.md'));
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(dir, `${id}.md`),
    '# Smoke Note\n\nOriginal revision content.\n',
    'utf8',
  );
  await fs.writeFile(
    path.join(dir, `${id}.json`),
    JSON.stringify({
      id,
      notePath: 'Smoke.md',
      createdAt: '2026-09-04T00:00:00.000Z',
      bytes: 41,
      sha256: 'smoke',
    }),
    'utf8',
  );
}

function runGit(cwd: string, args: readonly string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, { cwd, shell: false, windowsHide: true });
    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0
        ? resolve()
        : reject(new Error(stderr || `git fixture failed: ${code ?? 'unknown'}`)),
    );
  });
}
