import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { IndexSnapshot } from '../storage/IndexFormat.js';

export interface SensitiveRegion {
  filePath: string;
  line: number;
  kind: 'api-key' | 'token' | 'private-key' | 'password' | 'credential' | 'secret';
  confidence: number;
  snippet: string;
}

export async function detectSensitiveRegions(snapshot: IndexSnapshot): Promise<SensitiveRegion[]> {
  const results: SensitiveRegion[] = [];
  for (const file of snapshot.files) {
    const source = await readFile(path.join(snapshot.metadata.workspaceRoot, file.path), 'utf8').catch(() => '');
    if (!source) continue;
    const lines = source.split(/\r?\n/u);
    const fileLower = file.path.toLowerCase();
    for (let index = 0; index < lines.length; index++) {
      const line = lines[index] ?? '';
      const trimmed = line.trim();
      const matches = [
        { pattern: /(api[_-]?key|access[_-]?token|secret|private[_-]?key|password|credential|token)/iu, kind: 'credential' as const },
        { pattern: /BEGIN\s+(?:RSA\s+)?PRIVATE\s+KEY/iu, kind: 'private-key' as const },
        { pattern: /(?:aws|github|slack|stripe|openai|auth0)[-_]?(?:key|token)/iu, kind: 'api-key' as const }
      ];
      for (const candidate of matches) {
        if (candidate.pattern.test(trimmed) || fileLower.includes('.env')) {
          const snippet = trimmed.replace(/(:|=|\s+)(['"]?)[^\s'"]+/iu, '$1$2[redacted]').slice(0, 160);
          results.push({
            filePath: file.path,
            line: index + 1,
            kind: candidate.kind,
            confidence: fileLower.includes('.env') ? 0.9 : 0.75,
            snippet: snippet || 'sensitive configuration value'
          });
        }
      }
    }
  }
  return results;
}
