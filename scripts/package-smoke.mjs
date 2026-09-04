import { execFileSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';

const cli = path.resolve('node_modules', '.pnpm', 'playwright@1.62.1', 'node_modules', 'playwright', 'cli.js');
const executable = path.resolve('release', 'out', 'win-unpacked', 'KnowledgeStudio.exe');
execFileSync(process.execPath, [cli, 'test', '--config', 'playwright.electron.config.ts', '--grep', '@packaged'], {
  cwd: process.cwd(),
  env: { ...process.env, ELECTRON_E2E_EXECUTABLE: executable },
  stdio: 'inherit',
});
