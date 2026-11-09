import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sdkRoot = path.join(root, 'vendor', 'codebase-indexer');
const sdkDist = path.join(sdkRoot, 'dist');
const runtimeDist = path.join(root, 'dist', 'indexer-runtime');
const tsc = path.join(root, 'node_modules', 'typescript', 'bin', 'tsc');
const sdkTsconfig = path.join(root, 'scripts', 'codebase-indexer.tsconfig.json');

rmSync(sdkDist, { recursive: true, force: true });
mkdirSync(sdkDist, { recursive: true });
const compile = spawnSync(process.execPath, [tsc, '-p', sdkTsconfig], {
  cwd: root,
  stdio: 'inherit',
  env: process.env,
});
if (compile.status !== 0) process.exit(compile.status ?? 1);

const esbuild = await import('esbuild');
const workerOut = path.join(sdkDist, 'workers', 'GitHubIndexPartWorker.js');
mkdirSync(path.dirname(workerOut), { recursive: true });
await esbuild.build({
  entryPoints: [path.join(sdkRoot, 'src', 'github', 'GitHubIndexPartWorker.ts')],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  outfile: workerOut,
});

rmSync(runtimeDist, { recursive: true, force: true });
mkdirSync(runtimeDist, { recursive: true });
cpSync(path.join(sdkRoot, 'src', 'parser', 'grammars'), path.join(runtimeDist, 'grammars'), { recursive: true });
cpSync(path.join(root, 'node_modules', 'tree-sitter-wasms', 'out'), path.join(runtimeDist, 'tree-sitter-wasms'), { recursive: true });
cpSync(path.join(root, 'node_modules', 'web-tree-sitter', 'tree-sitter.wasm'), path.join(root, 'dist', 'tree-sitter.wasm'));
cpSync(path.join(root, 'node_modules', 'web-tree-sitter', 'tree-sitter.wasm'), path.join(runtimeDist, 'workers', 'tree-sitter.wasm'));
cpSync(path.join(sdkDist, 'workers'), path.join(runtimeDist, 'workers'), { recursive: true });
writeFileSync(path.join(runtimeDist, 'workers', 'package.json'), JSON.stringify({ type: 'module' }, null, 2) + '\n');
console.log('Built Codebase Indexer SDK from the pinned Git submodule and bundled parser/GitHub worker assets.');
