import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const release = path.join(root, 'release');
const workspace = path.join(release, '.deploy-workspace');
const stage = path.join(release, 'stage');
const desktop = path.join(root, 'apps', 'desktop');
const runtimePackages = [
  'ai-bridge',
  'ai-config',
  'attachments',
  'bases',
  'canvas',
  'change-feed',
  'commands',
  'git',
  'history',
  'import-export',
  'links',
  'markdown',
  'mcp',
  'mcp-host',
  'metadata',
  'observability',
  'pdf-annotations',
  'plugin-host',
  'plugin-sdk',
  'provenance',
  'rtl',
  'search',
  'security',
  'semantic-search',
  'settings',
  'shared',
  'tags',
  'templates',
  'vault',
  'web-clipper',
  'zotero',
];

await fs.rm(workspace, { recursive: true, force: true });
await fs.rm(stage, { recursive: true, force: true });
await fs.mkdir(path.join(workspace, 'apps', 'desktop'), { recursive: true });
await fs.mkdir(path.join(workspace, 'packages'), { recursive: true });

const rootManifest = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
await fs.writeFile(
  path.join(workspace, 'package.json'),
  JSON.stringify(
    {
      name: 'knowledge-studio-packaging',
      private: true,
      packageManager: rootManifest.packageManager,
    },
    null,
    2,
  ),
);
await fs.copyFile(path.join(root, 'pnpm-lock.yaml'), path.join(workspace, 'pnpm-lock.yaml'));
await fs.writeFile(
  path.join(workspace, 'pnpm-workspace.yaml'),
  'packages:\n  - apps/*\n  - packages/*\n\nallowBuilds:\n  electron-winstaller: false\n',
);
await fs.cp(
  path.join(desktop, 'package.json'),
  path.join(workspace, 'apps', 'desktop', 'package.json'),
);

for (const name of runtimePackages) {
  const source = path.join(root, 'packages', name);
  const target = path.join(workspace, 'packages', name);
  await fs.mkdir(target, { recursive: true });
  await fs.copyFile(path.join(source, 'package.json'), path.join(target, 'package.json'));
  await fs.cp(path.join(source, 'dist'), path.join(target, 'dist'), { recursive: true });
}

const packageManager = process.platform === 'win32' ? 'corepack' : 'corepack';
execFileSync(
  packageManager,
  ['pnpm', 'install', '--prod', '--offline', '--config.confirmModulesPurge=false'],
  {
    cwd: workspace,
    shell: process.platform === 'win32',
    stdio: 'inherit',
  },
);
execFileSync(
  packageManager,
  ['pnpm', '--filter', '@knowledge-studio/desktop', 'deploy', '--prod', '--legacy', stage],
  {
    cwd: workspace,
    shell: process.platform === 'win32',
    stdio: 'inherit',
  },
);

await fs.writeFile(
  path.join(stage, 'package-lock.json'),
  JSON.stringify({
    name: 'knowledge-studio',
    version: rootManifest.version ?? '0.1.0',
    lockfileVersion: 3,
    packages: {},
  }),
);
await fs.rm(path.join(stage, 'pnpm-lock.yaml'), { force: true });
await fs.rm(path.join(stage, 'pnpm-workspace.yaml'), { force: true });
await fs.rm(path.join(stage, 'dist-tsc'), { recursive: true, force: true });
await fs.rm(path.join(stage, 'src'), { recursive: true, force: true });
await fs.rm(
  path.join(stage, 'node_modules', '.pnpm', 'node_modules', '@knowledge-studio', 'desktop'),
  { force: true },
);
for (const entry of ['dist', 'dist-electron', 'electron-builder.yml']) {
  await fs.cp(path.join(desktop, entry), path.join(stage, entry), { recursive: true });
}

const removeDevelopmentFiles = async (directory) => {
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'tests' || entry.name === 'test' || entry.name === 'coverage')
        await fs.rm(absolute, { recursive: true, force: true });
      else await removeDevelopmentFiles(absolute);
    } else if (
      entry.name.endsWith('.map') ||
      entry.name.endsWith('.tsbuildinfo') ||
      entry.name.endsWith('.d.ts')
    )
      await fs.rm(absolute);
  }
};
await removeDevelopmentFiles(stage);
await fs.rm(workspace, { recursive: true, force: true });
console.log(JSON.stringify({ stage }, null, 2));
