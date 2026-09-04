import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { extractAll, listPackage } from '@electron/asar';

const root = process.cwd();
const stage = path.join(root, 'release', 'stage');
const appAsar = path.join(root, 'release', 'out', 'win-unpacked', 'resources', 'app.asar');
const workspacePackages = [
  'ai-config', 'canvas', 'git', 'history', 'links', 'markdown', 'mcp', 'mcp-host',
  'metadata', 'plugin-host', 'search', 'shared', 'tags', 'vault',
];
const requiredAppFiles = [
  'package.json',
  'dist/index.html',
  'dist-electron/electron/main.js',
  'dist-electron/electron/preload.cjs',
  ...workspacePackages.map((name) => `node_modules/@knowledge-studio/${name}/package.json`),
];
const forbiddenPathParts = [
  '/.git/', '/tests/', '/test/', '/coverage/', '/.tmp/', '/.artifacts/', '/.tsbuild/',
  '/user-data/', '/logs/', '/luckyai/',
];
const forbiddenFileNames = ['.env', 'desktop.ini', 'thumbs.db'];
const forbiddenText = [
  /E:[\\/]Projects[\\/]KnowledgeStudio/i,
  /E2E local manifest/i,
  /Current changed content\./i,
  /LuckyAI/i,
  /(?:api[_-]?key|token|secret|password)\s*[:=]\s*["'][^"']{8,}/i,
];

function normalize(file) {
  return file.replaceAll('\\', '/').replace(/^\/+/, '');
}

function assertAllowedPath(file) {
  const normalized = `/${normalize(file).toLowerCase()}`;
  if (forbiddenPathParts.some((part) => normalized.includes(part))) {
    throw new Error(`Forbidden packaged path: ${file}`);
  }
  if (forbiddenFileNames.includes(path.posix.basename(normalized))) {
    throw new Error(`Forbidden packaged file: ${file}`);
  }
  if (normalized.endsWith('.map') || normalized.endsWith('.tsbuildinfo')) {
    throw new Error(`Development artifact in package: ${file}`);
  }
}

function assertRequired(files, label) {
  const normalized = files.map(normalize);
  const known = new Set(normalized);
  for (const required of requiredAppFiles) {
    if (known.has(required)) continue;
    const suffix = `/${required}`;
    if (!normalized.some((file) => file.endsWith(suffix))) {
      throw new Error(`Missing ${label} runtime asset: ${required}`);
    }
  }
}

function assertText(file, content) {
  const text = content.toString('utf8');
  for (const expression of forbiddenText) {
    if (expression.test(text)) throw new Error(`Forbidden text ${expression} in ${file}`);
  }
}

async function walk(directory) {
  const output = [];
  const entries = await fs.readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    const relative = path.relative(directory, absolute);
    if (entry.isSymbolicLink()) {
      const target = await fs.realpath(absolute);
      const relativeTarget = path.relative(stage, target);
      if (relativeTarget.startsWith('..') || path.isAbsolute(relativeTarget)) {
        throw new Error(`Repository-coupled symlink in staging tree: ${absolute}`);
      }
      output.push(relative);
      continue;
    }
    if (entry.isDirectory()) {
      for (const child of await walk(absolute)) output.push(path.join(entry.name, child));
    } else if (entry.isFile()) {
      output.push(relative);
    }
  }
  return output;
}

async function auditStage() {
  const files = await walk(stage);
  files.forEach(assertAllowedPath);
  assertRequired(files, 'staged');
  for (const relative of files) {
    const absolute = path.join(stage, relative);
    const stat = await fs.stat(absolute);
    if (stat.size <= 1_000_000 && /\.(?:js|json|html|css|cjs|mjs)$/i.test(relative)) {
      assertText(relative, await fs.readFile(absolute));
    }
  }
  return { kind: 'stage', path: stage, files: files.length };
}

async function auditAsar() {
  await fs.access(appAsar);
  const files = listPackage(appAsar, { isPack: false }).map(normalize).filter(Boolean);
  files.forEach(assertAllowedPath);
  assertRequired(files, 'ASAR');
  const extractRoot = path.join(root, 'release', '.asar-audit');
  await fs.rm(extractRoot, { recursive: true, force: true });
  extractAll(appAsar, extractRoot);
  const extractedFiles = await walk(extractRoot);
  extractedFiles.forEach(assertAllowedPath);
  assertRequired(extractedFiles, 'ASAR');
  for (const relative of extractedFiles) {
    if (!/\.(?:js|json|html|css|cjs|mjs)$/i.test(relative)) continue;
    const content = await fs.readFile(path.join(extractRoot, relative));
    if (content.length <= 1_000_000) assertText(relative, content);
  }
  await fs.rm(extractRoot, { recursive: true, force: true });
  const unpacked = `${appAsar}.unpacked`;
  const unpackedExists = await fs.access(unpacked).then(() => true).catch(() => false);
  if (unpackedExists) throw new Error(`Unexpected ASAR unpacked runtime tree: ${unpacked}`);
  return { kind: 'asar', path: appAsar, files: files.length, asarUnpacked: false };
}

const target = process.argv[2] ?? 'all';
const results = [];
if (target === 'stage' || target === 'all') results.push(await auditStage());
if (target === 'asar' || target === 'all') results.push(await auditAsar());
if (!['stage', 'asar', 'all'].includes(target)) throw new Error(`Unknown audit target: ${target}`);
console.log(JSON.stringify({ audit: 'targeted-package-security', results }, null, 2));
