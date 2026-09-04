import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const stage = path.join(root, 'release', 'stage');
const desktop = path.join(root, 'apps', 'desktop');

await fs.rm(stage, { recursive: true, force: true });
await fs.mkdir(path.dirname(stage), { recursive: true });

const packageManager = process.platform === 'win32' ? 'corepack' : 'corepack';
execFileSync(packageManager, ['pnpm', '--filter', '@knowledge-studio/desktop', 'deploy', '--prod', '--legacy', stage], {
  shell: process.platform === 'win32',
  cwd: root,
  stdio: 'inherit',
});

await fs.rm(path.join(stage, 'dist-tsc'), { recursive: true, force: true });
await fs.rm(path.join(stage, 'src'), { recursive: true, force: true });
await fs.rm(path.join(stage, 'node_modules', '.pnpm', 'node_modules', '@knowledge-studio', 'desktop'), { force: true });

for (const entry of ['dist', 'dist-electron', 'electron-builder.yml']) {
  await fs.cp(path.join(desktop, entry), path.join(stage, entry), { recursive: true });
}

const removeGeneratedMaps = async (directory) => {
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'tests' || entry.name === 'test' || entry.name === 'coverage') {
        await fs.rm(absolute, { recursive: true, force: true });
      } else {
        await removeGeneratedMaps(absolute);
      }
    } else if (entry.name.endsWith('.map') || entry.name.endsWith('.tsbuildinfo') || entry.name.endsWith('.d.ts')) await fs.rm(absolute);
  }
};
await removeGeneratedMaps(stage);

console.log(JSON.stringify({ stage }, null, 2));
