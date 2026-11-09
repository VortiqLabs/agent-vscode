import type { IndexSnapshot } from '../storage/IndexFormat.js';

export interface RepositoryArea {
  name: string;
  path: string;
  kind: 'source' | 'test' | 'config' | 'docs' | 'infra' | 'unknown';
  files: number;
  symbols: number;
}

export interface RepositoryMap {
  root: string;
  areas: RepositoryArea[];
}

export interface FileComplexity {
  path: string;
  language: string;
  loc: number;
  symbolCount: number;
  fanIn: number;
  fanOut: number;
  cyclomaticEstimate: number;
}

export interface ComplexityReport {
  files: FileComplexity[];
  mostComplexFiles: FileComplexity[];
  averageLoc: number;
  totalLoc: number;
}

export interface DuplicateGroup {
  id: string;
  hash: string;
  chunkCount: number;
  similarity: number;
  chunks: Array<{ filePath: string; startLine: number; endLine: number; excerpt: string }>;
}

export interface DuplicatesReport {
  duplicateGroups: DuplicateGroup[];
  totalDuplicates: number;
}

export function buildRepositoryMap(snapshot: IndexSnapshot): RepositoryMap {
  const areaCounts = new Map<string, RepositoryArea>();
  const symbolCounts = new Map<string, number>();

  for (const file of snapshot.files) {
    const area = normalizeArea(file.path);
    const entry = areaCounts.get(area.path) ?? {
      name: area.name,
      path: area.path,
      kind: area.kind,
      files: 0,
      symbols: 0
    };
    entry.files += 1;
    areaCounts.set(area.path, entry);
  }

  for (const symbol of snapshot.symbols) {
    const area = normalizeArea(symbol.filePath);
    const key = area.path;
    const current = symbolCounts.get(key) ?? 0;
    symbolCounts.set(key, current + 1);
    const entry = areaCounts.get(key);
    if (entry) entry.symbols = symbolCounts.get(key) ?? entry.symbols;
  }

  const areas = [...areaCounts.values()].sort((left, right) => right.files - left.files || left.path.localeCompare(right.path));
  return { root: snapshot.metadata.workspaceRoot, areas };
}

export function analyzeComplexity(snapshot: IndexSnapshot): ComplexityReport {
  const fanInMap = new Map<string, number>();
  const fanOutMap = new Map<string, number>();
  const symbolFileMap = new Map<string, string>(snapshot.symbols.map((s) => [s.id, s.filePath]));

  for (const rel of snapshot.relations) {
    if (rel.filePath) {
      fanOutMap.set(rel.filePath, (fanOutMap.get(rel.filePath) ?? 0) + 1);
    }
    if (rel.toSymbolId) {
      const targetFile = symbolFileMap.get(rel.toSymbolId);
      if (targetFile) {
        fanInMap.set(targetFile, (fanInMap.get(targetFile) ?? 0) + 1);
      }
    }
  }

  const fileSymbolsMap = new Map<string, number>();
  for (const sym of snapshot.symbols) {
    fileSymbolsMap.set(sym.filePath, (fileSymbolsMap.get(sym.filePath) ?? 0) + 1);
  }

  let totalLoc = 0;
  const files: FileComplexity[] = snapshot.files.map((file) => {
    const symCount = fileSymbolsMap.get(file.path) ?? 0;
    const fanIn = fanInMap.get(file.path) ?? 0;
    const fanOut = fanOutMap.get(file.path) ?? 0;
    const estLoc = Math.max(10, (file.size ?? 100) / 35);
    totalLoc += Math.round(estLoc);
    const cyclomaticEstimate = Math.round(1 + symCount * 1.5 + fanOut * 0.8);

    return {
      path: file.path,
      language: file.language,
      loc: Math.round(estLoc),
      symbolCount: symCount,
      fanIn,
      fanOut,
      cyclomaticEstimate
    };
  });

  files.sort((a, b) => b.cyclomaticEstimate - a.cyclomaticEstimate);
  const averageLoc = files.length ? Math.round(totalLoc / files.length) : 0;

  return {
    files,
    mostComplexFiles: files.slice(0, 15),
    averageLoc,
    totalLoc
  };
}

export function detectDuplicates(snapshot: IndexSnapshot): DuplicatesReport {
  const hashGroupMap = new Map<string, typeof snapshot.chunks>();
  for (const chunk of snapshot.chunks) {
    if (chunk.text && chunk.text.trim().length > 30) {
      const list = hashGroupMap.get(chunk.hash) ?? [];
      list.push(chunk);
      hashGroupMap.set(chunk.hash, list);
    }
  }

  const duplicateGroups: DuplicateGroup[] = [];
  let groupId = 1;

  for (const [hash, chunks] of hashGroupMap.entries()) {
    if (chunks.length > 1) {
      duplicateGroups.push({
        id: `dup-${groupId++}`,
        hash: hash.slice(0, 12),
        chunkCount: chunks.length,
        similarity: 1.0,
        chunks: chunks.map((c) => ({
          filePath: c.filePath,
          startLine: c.startLine,
          endLine: c.endLine,
          excerpt: c.text.slice(0, 200)
        }))
      });
    }
  }

  return {
    duplicateGroups: duplicateGroups.slice(0, 20),
    totalDuplicates: duplicateGroups.length
  };
}

function normalizeArea(filePath: string): { name: string; path: string; kind: RepositoryArea['kind'] } {
  const normalized = filePath.split('/').filter(Boolean);
  const topLevel = normalized[0] ?? '.';
  const lower = filePath.toLowerCase();

  if (/(^|\/)(test|tests|__tests__|spec|specs)(\/|$)/u.test(filePath)) {
    return { name: topLevel === '.' ? 'tests' : topLevel, path: normalized.slice(0, 2).join('/') || topLevel, kind: 'test' };
  }
  if (/(?<![\w])(?:package\.json|tsconfig\.json|jsconfig\.json|pyproject\.toml|requirements\.txt|Cargo\.toml|go\.mod|pom\.xml|build\.gradle|CMakeLists\.txt|docker-compose\.|Dockerfile|\.env|eslint|prettier|vite|webpack|next|babel|rollup|turbo|nx).*$/iu.test(filePath)) {
    return { name: topLevel === '.' ? 'config' : topLevel, path: normalized.slice(0, 2).join('/') || topLevel, kind: 'config' };
  }
  if (/(^|\/)(docs?|documentation|readme|guides)(\/|$)/iu.test(filePath)) {
    return { name: topLevel === '.' ? 'docs' : topLevel, path: normalized.slice(0, 2).join('/') || topLevel, kind: 'docs' };
  }
  if (/(^|\/)(infra|infrastructure|deploy|ops|kubernetes|helm|docker|scripts|ci|cd|terraform)(\/|$)/iu.test(filePath)) {
    return { name: topLevel === '.' ? 'infra' : topLevel, path: normalized.slice(0, 2).join('/') || topLevel, kind: 'infra' };
  }

  const pathName = topLevel === '.' ? 'source' : topLevel;
  return {
    name: pathName,
    path: normalized.slice(0, 2).join('/') || topLevel,
    kind: lower.includes('src') || lower.includes('lib') || lower.includes('app') || lower.includes('pkg') ? 'source' : 'unknown'
  };
}
