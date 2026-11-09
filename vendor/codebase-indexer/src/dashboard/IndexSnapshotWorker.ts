import { parentPort, workerData } from 'node:worker_threads';
import { IndexReader } from '../storage/BinaryIndex.js';
import type { IndexSnapshot } from '../storage/IndexFormat.js';
import { detectApiEndpoints, detectDatabaseSchema, detectTestIntelligence, detectConfigAndDocIntelligence } from '../intelligence/ApiDetector.js';
import { buildRepositoryMap, analyzeComplexity, detectDuplicates } from '../intelligence/RepositoryMap.js';
import { findGraphCycles, getMatrixGraph, getRadialGraph, getFlowGraph, findSymbolPath } from '../intelligence/GraphQuery.js';
import { analyzeArchitecture } from '../intelligence/ArchitectureAnalyzer.js';

interface WorkerRequest {
  filePath: string;
  operation: 'summary' | 'graph' | 'search' | 'file' | 'intelligence' | 'cycles' | 'matrix' | 'radial' | 'flow' | 'complexity' | 'duplicates' | 'database' | 'tests' | 'configDoc' | 'path' | 'architecture';
  all?: boolean;
  query?: string;
  limit?: number;
  relativeFilePath?: string;
  from?: string;
  to?: string;
}

async function main(): Promise<void> {
  try {
    const request = workerData as WorkerRequest;
    const snapshot = await IndexReader.read(request.filePath);
    let value: unknown;
    switch (request.operation) {
      case 'summary':
        value = { metadata: snapshot.metadata, relationKinds: countRelationKinds(snapshot) };
        break;
      case 'graph':
        value = buildRelationGraph(snapshot, request.all ? Infinity : 80);
        break;
      case 'cycles':
        value = findGraphCycles(snapshot);
        break;
      case 'matrix':
        value = getMatrixGraph(snapshot);
        break;
      case 'radial':
        value = getRadialGraph(snapshot, request.query);
        break;
      case 'flow':
        value = getFlowGraph(snapshot);
        break;
      case 'path':
        value = findSymbolPath(snapshot, request.from ?? '', request.to ?? '');
        break;
      case 'architecture':
        value = await analyzeArchitecture(snapshot);
        break;
      case 'complexity':
        value = analyzeComplexity(snapshot);
        break;
      case 'duplicates':
        value = detectDuplicates(snapshot);
        break;
      case 'database':
        value = detectDatabaseSchema(snapshot);
        break;
      case 'tests':
        value = detectTestIntelligence(snapshot);
        break;
      case 'configDoc':
        value = detectConfigAndDocIntelligence(snapshot);
        break;
      case 'search':
        value = searchSnapshot(snapshot, request.query ?? '', request.limit ?? 50);
        break;
      case 'file':
        value = snapshot.files.find((file) => file.path === request.relativeFilePath);
        break;
      case 'intelligence':
        value = {
          repositoryMap: buildRepositoryMap(snapshot),
          apiEndpoints: await detectApiEndpoints(snapshot)
        };
        break;
    }
    parentPort?.postMessage({ ok: true, value });
  } catch (error) {
    parentPort?.postMessage({ ok: false, error: error instanceof Error ? error.message : String(error) });
  } finally {
    parentPort?.close();
  }
}

function countRelationKinds(snapshot: IndexSnapshot): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const relation of snapshot.relations) counts[relation.kind] = (counts[relation.kind] ?? 0) + 1;
  return counts;
}

function buildRelationGraph(snapshot: IndexSnapshot, nodeLimit: number) {
  const degree = new Map<string, number>();
  for (const relation of snapshot.relations) {
    if (relation.fromSymbolId) degree.set(relation.fromSymbolId, (degree.get(relation.fromSymbolId) ?? 0) + 1);
    if (relation.toSymbolId) degree.set(relation.toSymbolId, (degree.get(relation.toSymbolId) ?? 0) + 1);
  }
  const orderedSymbols = [...snapshot.symbols].sort((left, right) =>
    (degree.get(right.id) ?? 0) - (degree.get(left.id) ?? 0) || left.name.localeCompare(right.name));
  const selectedSymbols = orderedSymbols.slice(0, nodeLimit);
  const selectedIds = new Set(selectedSymbols.map((symbol) => symbol.id));
  return {
    nodes: selectedSymbols.map(({ id, name, kind, filePath, startLine, endLine, startColumn, endColumn }) => ({
      id, name, kind, filePath, startLine, endLine, startColumn, endColumn
    })),
    edges: snapshot.relations.flatMap((relation) =>
      relation.fromSymbolId && relation.toSymbolId && selectedIds.has(relation.fromSymbolId) && selectedIds.has(relation.toSymbolId)
        ? [{
          id: relation.id,
          source: relation.fromSymbolId,
          target: relation.toSymbolId,
          kind: relation.kind,
          confidence: relation.confidence
        }]
        : []),
    truncated: snapshot.symbols.length > selectedSymbols.length
  };
}

function searchSnapshot(snapshot: IndexSnapshot, query: string, limit: number) {
  const terms = [...new Set(query.toLowerCase().match(/[\p{L}\p{N}_$.-]+/gu) ?? [])];
  if (terms.length === 0) return [];
  const symbolsByPath = new Map<string, string[]>();
  for (const symbol of snapshot.symbols) {
    symbolsByPath.set(symbol.filePath, [...(symbolsByPath.get(symbol.filePath) ?? []), symbol.name]);
  }
  return snapshot.files.flatMap((file) => {
    const matchingTerms = terms.filter((term) => file.terms.includes(term));
    const pathMatches = terms.filter((term) => file.path.toLowerCase().includes(term));
    const matchingSymbols = (symbolsByPath.get(file.path) ?? []).filter((name) =>
      terms.some((term) => name.toLowerCase().includes(term)));
    const score = matchingTerms.length * 2 + pathMatches.length + matchingSymbols.length * 4;
    if (score === 0) return [];
    const excerpt = snapshot.chunks.find((chunk) => chunk.filePath === file.path &&
      terms.some((term) => chunk.text.toLowerCase().includes(term)))?.text.slice(0, 280);
    return [{
      uid: snapshot.metadata.uid,
      workspace: snapshot.metadata.workspaceRoot,
      path: file.path,
      language: file.language,
      score,
      ...(excerpt ? { excerpt } : {})
    }];
  }).sort((left, right) => right.score - left.score || left.path.localeCompare(right.path)).slice(0, limit);
}

void main();
