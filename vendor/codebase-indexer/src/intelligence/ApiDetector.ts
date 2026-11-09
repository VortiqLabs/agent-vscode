import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { IndexSnapshot } from '../storage/IndexFormat.js';

export interface ApiEndpoint {
  id: string;
  method: string;
  path: string;
  fileId: string;
  symbolId?: string;
  startLine: number;
  endLine: number;
}

export interface DatabaseModel {
  name: string;
  kind: 'prisma' | 'sql' | 'orm' | 'migration';
  filePath: string;
  tableOrModel: string;
}

export interface TestMapping {
  testFile: string;
  testSymbol: string;
  targetSymbol?: string;
  framework: string;
}

export interface ConfigDocInfo {
  configs: Array<{ filePath: string; type: string; format: string }>;
  docs: Array<{ filePath: string; title: string; linkedSymbols: string[] }>;
}

export async function detectApiEndpoints(snapshot: IndexSnapshot): Promise<ApiEndpoint[]> {
  const endpoints: ApiEndpoint[] = [];
  const symbolByFile = new Map<string, Set<string>>();
  for (const symbol of snapshot.symbols) {
    const set = symbolByFile.get(symbol.filePath) ?? new Set<string>();
    set.add(symbol.name);
    symbolByFile.set(symbol.filePath, set);
  }

  for (const file of snapshot.files) {
    const source = await readFile(path.join(snapshot.metadata.workspaceRoot, file.path), 'utf8').catch(() => '');
    if (!source) continue;

    const patterns = [
      /(?:app|router|server|fastify|api)\.(get|post|put|delete|patch|options|head)\s*\(\s*['"`](.+?)['"`]/giu,
      /@(?:Get|Post|Put|Delete|Patch|RequestMapping|GetMapping|PostMapping)\s*\(\s*['"`](.+?)['"`]/giu,
      /(?:route|router)\s*\(\s*['"`](.+?)['"`]/giu,
      /(?:path|r)\.(get|post|put|delete|patch|options|head)\s*\(\s*['"`](.+?)['"`]/giu,
      /\b(?:@app|@bp)\.(?:route|get|post|put|delete|patch)\s*\(\s*['"`](.+?)['"`]/giu,
      /\[(?:HttpGet|HttpPost|HttpPut|HttpDelete|HttpPatch)\]\s*(?:async\s+)?(?:function\s+)?([A-Za-z0-9_]+)/giu
    ];

    for (const pattern of patterns) {
      for (const match of source.matchAll(pattern)) {
        const method = String(match[1] ?? 'GET').toUpperCase();
        const route = String(match[2] ?? match[0] ?? '/').trim();
        if (!route.startsWith('/') && !route.startsWith('http') && !route.startsWith('{')) {
          continue;
        }
        const line = source.slice(0, match.index ?? 0).split('\n').length;
        const l = route || '/';
        const symbolId = [...(symbolByFile.get(file.path) ?? [])].find((name) => source.slice(0, match.index ?? 0).includes(name));
        endpoints.push({
          id: createHash('sha256').update(`${file.path}:${method}:${l}:${line}`).digest('hex').slice(0, 24),
          method,
          path: l,
          fileId: file.path,
          ...(symbolId ? { symbolId } : {}),
          startLine: line,
          endLine: line + 1
        });
      }
    }
  }

  return endpoints;
}

export function detectDatabaseSchema(snapshot: IndexSnapshot): DatabaseModel[] {
  const models: DatabaseModel[] = [];

  for (const file of snapshot.files) {
    const lower = file.path.toLowerCase();
    if (lower.endsWith('.prisma')) {
      models.push({ name: path.basename(file.path), kind: 'prisma', filePath: file.path, tableOrModel: 'Prisma Schema' });
    } else if (lower.endsWith('.sql') || lower.includes('/migrations/') || lower.includes('/migrate/')) {
      models.push({ name: path.basename(file.path), kind: 'sql', filePath: file.path, tableOrModel: 'SQL Schema / Migration' });
    } else if (lower.includes('model') || lower.includes('entity') || lower.includes('schema')) {
      models.push({ name: path.basename(file.path), kind: 'orm', filePath: file.path, tableOrModel: 'ORM Model' });
    }
  }

  return models;
}

export function detectTestIntelligence(snapshot: IndexSnapshot): TestMapping[] {
  const mappings: TestMapping[] = [];
  const symbolNames = new Set(snapshot.symbols.map((s) => s.name));

  for (const file of snapshot.files) {
    const lower = file.path.toLowerCase();
    if (lower.includes('test') || lower.includes('spec') || lower.includes('__tests__')) {
      const framework = lower.endsWith('.py') ? 'pytest / unittest' : lower.endsWith('.go') ? 'go test' : lower.endsWith('.rs') ? 'cargo test' : 'jest / node:test / vitest';
      const fileSymbols = snapshot.symbols.filter((s) => s.filePath === file.path);
      for (const sym of fileSymbols) {
        const target = [...symbolNames].find((name) => name !== sym.name && sym.name.toLowerCase().includes(name.toLowerCase()));
        mappings.push({
          testFile: file.path,
          testSymbol: sym.name,
          ...(target ? { targetSymbol: target } : {}),
          framework
        });
      }
    }
  }

  return mappings;
}

export function detectConfigAndDocIntelligence(snapshot: IndexSnapshot): ConfigDocInfo {
  const configs: ConfigDocInfo['configs'] = [];
  const docs: ConfigDocInfo['docs'] = [];
  const allSymbolNames = snapshot.symbols.slice(0, 100).map((s) => s.name);

  for (const file of snapshot.files) {
    const lower = file.path.toLowerCase();
    if (lower.endsWith('.json') || lower.endsWith('.toml') || lower.endsWith('.yaml') || lower.endsWith('.yml') || lower.includes('docker') || lower.includes('config')) {
      configs.push({
        filePath: file.path,
        type: lower.includes('docker') ? 'Container' : lower.includes('package.json') ? 'Dependencies' : 'Configuration',
        format: file.language
      });
    } else if (lower.endsWith('.md') || lower.endsWith('.rst') || lower.includes('doc')) {
      docs.push({
        filePath: file.path,
        title: path.basename(file.path, path.extname(file.path)),
        linkedSymbols: allSymbolNames.filter((name) => name.length > 3 && file.terms.includes(name.toLowerCase())).slice(0, 5)
      });
    }
  }

  return { configs, docs };
}
