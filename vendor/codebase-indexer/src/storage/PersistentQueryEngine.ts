import { DatabaseSync } from 'node:sqlite';
import type { FileRecord } from '../types/FileRecord.js';
import type { RelationRecord } from '../types/Relation.js';
import type { SymbolRecord } from '../types/Symbol.js';

interface FileRow { path: string; language: string; hash: string; size: number; modifiedAt: number; terms: string; }
interface SymbolRow { id: string; filePath: string; name: string; kind: string; startLine: number; endLine: number; startColumn: number; endColumn: number; parentId: string | null; }
interface RelationRow { id: string; kind: string; filePath: string; fromSymbolId: string | null; toSymbolId: string | null; targetName: string; line: number; confidence: number; }

/** Indexed SQL query facade over the durable SQLite sidecar produced by the indexer. */
export class PersistentQueryEngine {
  private readonly db: DatabaseSync;

  constructor(databasePath: string) {
    this.db = new DatabaseSync(databasePath);
    this.db.exec('PRAGMA query_only = ON; PRAGMA busy_timeout = 5000;');
  }

  search(query: string, limit = 10): Array<{ file: FileRecord; score: number }> {
    const terms = [...new Set(query.toLowerCase().match(/[\p{L}\p{N}_$.-]+/gu) ?? [])];
    if (!terms.length) return [];
    const score = terms.map(() => `
      (SELECT COUNT(*) FROM file_terms ft WHERE ft.filePath = f.path AND ft.term = ?) * 2
      + CASE WHEN instr(lower(f.path), ?) > 0 THEN 1 ELSE 0 END
      + (SELECT COUNT(*) FROM symbols s WHERE s.filePath = f.path AND instr(lower(s.name), ?) > 0) * 4
    `).join(' + ');
    const rows = this.db.prepare(`
      SELECT f.*, (${score}) AS score FROM files f
      WHERE (${score}) > 0
      ORDER BY score DESC, f.path ASC LIMIT ?
    `).all(...terms.flatMap((term) => [term, term, term]), ...terms.flatMap((term) => [term, term, term]), limit) as unknown as Array<FileRow & { score: number }>;
    return rows.map((row) => ({ file: mapFile(row), score: Number(row.score) }));
  }

  getFile(filePath: string): FileRecord | undefined {
    const row = this.db.prepare('SELECT * FROM files WHERE path = ?').get(filePath) as FileRow | undefined;
    return row ? mapFile(row) : undefined;
  }

  findSymbols(query: string): SymbolRecord[] {
    const rows = this.db.prepare('SELECT * FROM symbols WHERE instr(lower(name), ?) > 0 ORDER BY name, filePath, startLine').all(query.toLowerCase()) as unknown as SymbolRow[];
    return rows.map(mapSymbol);
  }

  findReferences(query: string): RelationRecord[] {
    const rows = this.db.prepare('SELECT * FROM relations WHERE lower(targetName) = ? ORDER BY filePath, line').all(query.toLowerCase()) as unknown as RelationRow[];
    return rows.map(mapRelation);
  }

  findCallers(query: string): RelationRecord[] {
    const rows = this.db.prepare(`
      SELECT r.* FROM relations r JOIN symbols s ON s.id = r.toSymbolId
      WHERE r.kind = 'calls' AND lower(s.name) = ? ORDER BY r.filePath, r.line
    `).all(query.toLowerCase()) as unknown as RelationRow[];
    return rows.map(mapRelation);
  }

  findCallees(query: string): RelationRecord[] {
    const rows = this.db.prepare(`
      SELECT r.* FROM relations r JOIN symbols s ON s.id = r.fromSymbolId
      WHERE r.kind = 'calls' AND lower(s.name) = ? ORDER BY r.filePath, r.line
    `).all(query.toLowerCase()) as unknown as RelationRow[];
    return rows.map(mapRelation);
  }

  close(): void { this.db.close(); }
}

function mapFile(row: FileRow): FileRecord {
  return { path: row.path, language: row.language, hash: row.hash, size: Number(row.size), modifiedAt: Number(row.modifiedAt), terms: JSON.parse(row.terms) as string[] };
}
function mapSymbol(row: SymbolRow): SymbolRecord {
  return { id: row.id, filePath: row.filePath, name: row.name, kind: row.kind as SymbolRecord['kind'], startLine: Number(row.startLine), endLine: Number(row.endLine), startColumn: Number(row.startColumn), endColumn: Number(row.endColumn), ...(row.parentId ? { parentId: row.parentId } : {}) };
}
function mapRelation(row: RelationRow): RelationRecord {
  return { id: row.id, kind: row.kind as RelationRecord['kind'], filePath: row.filePath, ...(row.fromSymbolId ? { fromSymbolId: row.fromSymbolId } : {}), ...(row.toSymbolId ? { toSymbolId: row.toSymbolId } : {}), targetName: row.targetName, line: Number(row.line), confidence: Number(row.confidence) };
}
