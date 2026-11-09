import path from 'node:path';
import { readFile } from 'node:fs/promises';
import type { IndexSnapshot } from '../storage/IndexFormat.js';

export interface ArchitectureDependency {
  from: string;
  to: string;
  imports: number;
  lines: number[];
}

export interface ArchitectureCycle {
  files: string[];
  size: number;
}

export interface ArchitectureFileSummary {
  path: string;
  fanIn: number;
  fanOut: number;
  dependencyCount: number;
  dependentCount: number;
}

export interface ArchitectureReport {
  files: ArchitectureFileSummary[];
  dependencies: ArchitectureDependency[];
  cycles: ArchitectureCycle[];
  unresolvedRelativeImports: Array<{ filePath: string; target: string; line: number }>;
  unresolvedAliasImports: Array<{ filePath: string; target: string; line: number }>;
  externalPackages: Array<{ name: string; importedBy: number; files: string[] }>;
  resolvedAliases: Array<{ alias: string; target: string; files: number }>;
  workspacePackages: Array<{ name: string; root: string; entryPoints: string[] }>; 
  entryCandidates: string[];
  mostDependedOn: ArchitectureFileSummary[];
  caveats: string[];
}

const EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs', '.py', '.go', '.rs', '.java', '.cs', '.kt', '.kts', '.swift', '.rb', '.php', '.vue', '.svelte'];

interface TsConfigPaths {
  baseUrl: string;
  paths: Record<string, string[]>;
}

interface WorkspacePackage {
  name: string;
  root: string;
  entryPoints: string[];
}

/** Builds a file-level dependency graph from relative, tsconfig-alias, and workspace-package imports. */
export async function analyzeArchitecture(snapshot: IndexSnapshot, workspaceRoot = snapshot.metadata.workspaceRoot): Promise<ArchitectureReport> {
  const filePaths = new Set(snapshot.files.map((file) => normalizePath(file.path)));
  const edges = new Map<string, { imports: number; lines: Set<number> }>();
  const unresolvedRelativeImports: ArchitectureReport['unresolvedRelativeImports'] = [];
  const unresolvedAliasImports: ArchitectureReport['unresolvedAliasImports'] = [];
  const config = await loadTsConfigPaths(workspaceRoot);
  const workspacePackages = await loadWorkspacePackages(snapshot, workspaceRoot, filePaths);
  const packageByName = new Map(workspacePackages.map((item) => [item.name, item]));
  const externalPackageCounts = new Map<string, number>();
  const aliasCounts = new Map<string, { target: string; files: Set<string> }>();

  for (const relation of snapshot.relations) {
    if (relation.kind !== 'imports') continue;
    const target = relation.targetName.trim().replace(/^['"]|['"]$/gu, '');
    let resolved: string | undefined;
    if (target.startsWith('.')) {
      resolved = resolveRelativeImport(relation.filePath, target, filePaths);
      if (!resolved) unresolvedRelativeImports.push({ filePath: relation.filePath, target, line: relation.line });
    } else {
      const alias = resolveTsAlias(relation.filePath, target, config, filePaths);
      if (alias) {
        resolved = alias.file;
        const record = aliasCounts.get(alias.pattern) ?? { target: alias.mappedTarget, files: new Set<string>() };
        record.files.add(resolved);
        aliasCounts.set(alias.pattern, record);
      } else {
        const packageName = getPackageName(target);
        const workspacePackage = packageByName.get(packageName);
        if (workspacePackage) {
          const packageSubpath = target.slice(packageName.length);
          resolved = packageSubpath ? resolvePackageSubpath(workspacePackage.root, packageSubpath, filePaths) : workspacePackage.entryPoints[0];
        } else {
          externalPackageCounts.set(packageName, (externalPackageCounts.get(packageName) ?? 0) + 1);
          continue;
        }
      }
      if (!resolved) {
        if (config && matchesAlias(target, config.paths)) unresolvedAliasImports.push({ filePath: relation.filePath, target, line: relation.line });
        continue;
      }
    }
    if (!resolved) continue;
    if (resolved === normalizePath(relation.filePath)) continue;
    const key = `${normalizePath(relation.filePath)}\0${resolved}`;
    const current = edges.get(key) ?? { imports: 0, lines: new Set<number>() };
    current.imports += 1;
    current.lines.add(relation.line);
    edges.set(key, current);
  }

  const dependencies: ArchitectureDependency[] = [...edges.entries()].map(([key, value]) => {
    const [from, to] = key.split('\0');
    return { from: from!, to: to!, imports: value.imports, lines: [...value.lines].sort((a, b) => a - b) };
  }).sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to));

  const outgoing = new Map<string, Set<string>>();
  const incoming = new Map<string, Set<string>>();
  for (const filePath of filePaths) {
    outgoing.set(filePath, new Set());
    incoming.set(filePath, new Set());
  }
  for (const edge of dependencies) {
    outgoing.get(edge.from)?.add(edge.to);
    incoming.get(edge.to)?.add(edge.from);
  }

  const files = [...filePaths].sort().map((filePath) => ({
    path: filePath,
    fanIn: incoming.get(filePath)?.size ?? 0,
    fanOut: outgoing.get(filePath)?.size ?? 0,
    dependencyCount: outgoing.get(filePath)?.size ?? 0,
    dependentCount: incoming.get(filePath)?.size ?? 0
  }));

  const cycles = stronglyConnectedComponents([...filePaths], outgoing)
    .filter((component) => component.length > 1 || outgoing.get(component[0]!)?.has(component[0]!))
    .map((component) => ({ files: component.sort(), size: component.length }))
    .sort((a, b) => b.size - a.size || a.files[0]!.localeCompare(b.files[0]!));

  const mostDependedOn = [...files].sort((a, b) => b.fanIn - a.fanIn || a.path.localeCompare(b.path)).slice(0, 10);
  const entryCandidates = files.filter((file) => file.fanIn === 0 && file.fanOut > 0).map((file) => file.path);

  return {
    files,
    dependencies,
    cycles,
    unresolvedRelativeImports: unresolvedRelativeImports.sort((a, b) => a.filePath.localeCompare(b.filePath) || a.line - b.line),
    unresolvedAliasImports: unresolvedAliasImports.sort((a, b) => a.filePath.localeCompare(b.filePath) || a.line - b.line),
    externalPackages: [...externalPackageCounts.entries()].map(([name, importedBy]) => ({ name, importedBy, files: [...new Set(snapshot.relations.filter((relation) => relation.kind === 'imports' && getPackageName(relation.targetName) === name).map((relation) => relation.filePath))].sort() })).sort((a, b) => b.importedBy - a.importedBy || a.name.localeCompare(b.name)),
    resolvedAliases: [...aliasCounts.entries()].map(([alias, value]) => ({ alias, target: value.target, files: [...value.files].sort() })).map((item) => ({ alias: item.alias, target: item.target, files: item.files.length })),
    workspacePackages,
    entryCandidates,
    mostDependedOn,
    caveats: [
      'Relative imports, configured TypeScript path aliases, and workspace packages are resolved when their targets are present in the index.',
      'External packages are inventoried but their internal implementation is not part of this workspace graph.',
      'Dynamic imports, generated modules, package export conditions, and runtime-loaded dependencies may be absent.',
      'Entry candidates are files with no incoming relative imports, not guaranteed application entry points.'
    ]
  };
}

async function loadTsConfigPaths(root: string): Promise<TsConfigPaths | undefined> {
  for (const name of ['tsconfig.json', 'jsconfig.json']) {
    try {
      const raw = await readFile(path.join(root, name), 'utf8');
      const parsed = JSON.parse(stripJsonComments(raw)) as { compilerOptions?: { baseUrl?: string; paths?: Record<string, string[]> } };
      const paths = parsed.compilerOptions?.paths;
      if (!paths || typeof paths !== 'object') continue;
      return { baseUrl: parsed.compilerOptions?.baseUrl ?? '.', paths };
    } catch { /* Missing or invalid optional project config: continue with other resolution strategies. */ }
  }
  return undefined;
}

function stripJsonComments(value: string): string {
  return value.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/^\s*\/\/.*$/gmu, '').replace(/,\s*([}\]])/gu, '$1');
}

async function loadWorkspacePackages(snapshot: IndexSnapshot, root: string, files: Set<string>): Promise<WorkspacePackage[]> {
  const manifests = [...files].filter((file) => path.posix.basename(file) === 'package.json');
  const packages: WorkspacePackage[] = [];
  for (const manifest of manifests) {
    try {
      const parsed = JSON.parse(await readFile(path.join(root, manifest), 'utf8')) as { name?: string; main?: string; module?: string; types?: string; exports?: unknown };
      if (!parsed.name) continue;
      const packageRoot = path.posix.dirname(manifest) === '.' ? '' : path.posix.dirname(manifest);
      const candidates = [parsed.types, parsed.module, parsed.main, 'src/index.ts', 'src/index.js', 'index.ts', 'index.js'].filter((item): item is string => Boolean(item));
      const entryPoints = candidates.map((candidate) => resolvePackageSubpath(packageRoot, candidate, files)).filter((item): item is string => Boolean(item));
      packages.push({ name: parsed.name, root: packageRoot, entryPoints: [...new Set(entryPoints)] });
    } catch { /* Ignore malformed or unreadable package manifests. */ }
  }
  return packages.sort((a, b) => a.name.localeCompare(b.name));
}

function getPackageName(specifier: string): string {
  const parts = specifier.split('/');
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0] ?? specifier;
}

function resolvePackageSubpath(packageRoot: string, subpath: string, files: Set<string>): string | undefined {
  const clean = subpath.replace(/^\//u, '').replace(/^\.\//u, '');
  const base = normalizePath(path.posix.join(packageRoot, clean || ''));
  const candidates = new Set<string>([base]);
  if (!path.posix.extname(base)) {
    for (const extension of EXTENSIONS) candidates.add(`${base}${extension}`);
    for (const extension of EXTENSIONS) candidates.add(`${base}/index${extension}`);
  }
  for (const candidate of candidates) if (files.has(candidate)) return candidate;
  return undefined;
}

function matchesAlias(target: string, paths: Record<string, string[]>): boolean {
  return Object.keys(paths).some((pattern) => aliasMatch(pattern, target) !== undefined);
}

function resolveTsAlias(fromFile: string, target: string, config: TsConfigPaths | undefined, files: Set<string>): { file: string; pattern: string; mappedTarget: string } | undefined {
  if (!config) return undefined;
  const base = normalizePath(config.baseUrl);
  const ordered = Object.entries(config.paths).map(([pattern, mappings]) => ({ pattern, mappings, prefix: pattern.indexOf('*') < 0 ? pattern.length : pattern.indexOf('*') }))
    .sort((a, b) => b.prefix - a.prefix);
  for (const item of ordered) {
    const wildcard = aliasMatch(item.pattern, target);
    if (wildcard === undefined) continue;
    for (const mapping of item.mappings) {
      const mapped = mapping.replace('*', wildcard);
      const absoluteBase = normalizePath(path.posix.join(base, mapped));
      const relativeBase = normalizePath(path.posix.join(path.posix.dirname(fromFile), mapped));
      const candidates = [resolvePackageSubpath('', absoluteBase, files), resolvePackageSubpath('', relativeBase, files)].filter((value): value is string => Boolean(value));
      if (candidates[0]) return { file: candidates[0], pattern: item.pattern, mappedTarget: mapped };
    }
  }
  return undefined;
}

function aliasMatch(pattern: string, target: string): string | undefined {
  const star = pattern.indexOf('*');
  if (star < 0) return pattern === target ? '' : undefined;
  const prefix = pattern.slice(0, star);
  const suffix = pattern.slice(star + 1);
  if (!target.startsWith(prefix) || !target.endsWith(suffix) || target.length < prefix.length + suffix.length) return undefined;
  return target.slice(prefix.length, target.length - suffix.length || undefined);
}

function resolveRelativeImport(fromFile: string, target: string, files: Set<string>): string | undefined {
  const base = normalizePath(path.posix.normalize(path.posix.join(path.posix.dirname(normalizePath(fromFile)), target)));
  const candidates = new Set<string>([base]);
  if (path.posix.extname(base)) {
    const extension = path.posix.extname(base);
    if (['.js', '.jsx', '.mjs', '.cjs'].includes(extension)) {
      const stem = base.slice(0, -extension.length);
      for (const replacement of ['.ts', '.tsx', '.mts', '.cts']) candidates.add(`${stem}${replacement}`);
    }
  } else {
    for (const extension of EXTENSIONS) candidates.add(`${base}${extension}`);
    for (const extension of EXTENSIONS) candidates.add(`${base}/index${extension}`);
  }
  for (const candidate of candidates) if (files.has(candidate)) return candidate;
  return undefined;
}

function stronglyConnectedComponents(nodes: string[], adjacency: Map<string, Set<string>>): string[][] {
  const reverse = new Map<string, Set<string>>();
  for (const node of nodes) reverse.set(node, new Set());
  for (const [from, targets] of adjacency) {
    for (const to of targets) reverse.get(to)?.add(from);
  }

  // Iterative Kosaraju avoids call-stack overflow on very deep dependency chains.
  const visited = new Set<string>();
  const finishOrder: string[] = [];
  for (const start of nodes) {
    if (visited.has(start)) continue;
    const stack: Array<{ node: string; expanded: boolean }> = [{ node: start, expanded: false }];
    while (stack.length > 0) {
      const current = stack.pop()!;
      if (current.expanded) {
        finishOrder.push(current.node);
        continue;
      }
      if (visited.has(current.node)) continue;
      visited.add(current.node);
      stack.push({ node: current.node, expanded: true });
      for (const neighbor of adjacency.get(current.node) ?? []) {
        if (!visited.has(neighbor)) stack.push({ node: neighbor, expanded: false });
      }
    }
  }

  visited.clear();
  const components: string[][] = [];
  for (let index = finishOrder.length - 1; index >= 0; index--) {
    const start = finishOrder[index]!;
    if (visited.has(start)) continue;
    const component: string[] = [];
    const stack = [start];
    visited.add(start);
    while (stack.length > 0) {
      const node = stack.pop()!;
      component.push(node);
      for (const neighbor of reverse.get(node) ?? []) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          stack.push(neighbor);
        }
      }
    }
    components.push(component);
  }
  return components;
}

function normalizePath(value: string): string {
  return value.replace(/\\/gu, '/').replace(/^\.\//u, '');
}
