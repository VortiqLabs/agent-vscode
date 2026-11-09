import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { CodeChunk } from '../types/CodeChunk.js';
import type { FileRecord } from '../types/FileRecord.js';
import type { RelationRecord } from '../types/Relation.js';
import type { SymbolRecord } from '../types/Symbol.js';
import type { VectorRecord } from '../types/VectorRecord.js';
import type { IndexMetadata, IndexSnapshot } from './IndexFormat.js';

export class StagingDatabase {
  readonly db: DatabaseSync;

  constructor(dbPath: string) {
    mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.initTables();
  }

  private initTables(): void {
    this.db.exec('PRAGMA synchronous = OFF;');
    this.db.exec('PRAGMA journal_mode = MEMORY;');
    this.db.exec('PRAGMA cache_size = -8000;');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS metadata (
        key TEXT PRIMARY KEY,
        value TEXT
      );
      CREATE TABLE IF NOT EXISTS files (
        path TEXT PRIMARY KEY,
        language TEXT,
        hash TEXT,
        size INTEGER,
        modifiedAt REAL,
        terms TEXT
      );
      CREATE TABLE IF NOT EXISTS file_terms (
        filePath TEXT NOT NULL,
        term TEXT NOT NULL,
        PRIMARY KEY (filePath, term)
      );
      CREATE TABLE IF NOT EXISTS symbols (
        id TEXT PRIMARY KEY,
        filePath TEXT,
        name TEXT,
        kind TEXT,
        startLine INTEGER,
        endLine INTEGER,
        startColumn INTEGER,
        endColumn INTEGER,
        parentId TEXT
      );
      CREATE TABLE IF NOT EXISTS relations (
        id TEXT PRIMARY KEY,
        kind TEXT,
        filePath TEXT,
        fromSymbolId TEXT,
        toSymbolId TEXT,
        targetName TEXT,
        normalizedTargetName TEXT,
        line INTEGER,
        confidence REAL
      );
      CREATE TABLE IF NOT EXISTS chunks (
        id TEXT PRIMARY KEY,
        filePath TEXT,
        symbolId TEXT,
        startLine INTEGER,
        endLine INTEGER,
        hash TEXT,
        text TEXT
      );
      CREATE TABLE IF NOT EXISTS vectors (
        chunkId TEXT PRIMARY KEY,
        chunkHash TEXT,
        providerId TEXT,
        dimensions INTEGER,
        "values" TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_file_terms_term_path ON file_terms(term, filePath);
      CREATE INDEX IF NOT EXISTS idx_symbols_filePath ON symbols(filePath);
      CREATE INDEX IF NOT EXISTS idx_symbols_name ON symbols(name);
      CREATE INDEX IF NOT EXISTS idx_symbols_name_path ON symbols(name, filePath);
      CREATE INDEX IF NOT EXISTS idx_relations_filePath ON relations(filePath);
      CREATE INDEX IF NOT EXISTS idx_relations_targetName ON relations(targetName);
      CREATE INDEX IF NOT EXISTS idx_relations_normalizedTargetName ON relations(normalizedTargetName);
      CREATE INDEX IF NOT EXISTS idx_relations_fromSymbolId ON relations(fromSymbolId);
      CREATE INDEX IF NOT EXISTS idx_relations_toSymbolId ON relations(toSymbolId);
      CREATE INDEX IF NOT EXISTS idx_chunks_filePath ON chunks(filePath);
      CREATE INDEX IF NOT EXISTS idx_chunks_hash ON chunks(hash);
    `);
  }

  setMetadata(metadata: IndexMetadata): void {
    const stmt = this.db.prepare('INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?)');
    this.db.exec('BEGIN TRANSACTION');
    for (const [key, val] of Object.entries(metadata)) {
      stmt.run(key, typeof val === 'object' ? JSON.stringify(val) : String(val));
    }
    this.db.exec('COMMIT');
  }

  getMetadata(): Partial<IndexMetadata> {
    const rows = this.db.prepare('SELECT key, value FROM metadata').all() as Array<{ key: string; value: string }>;
    const meta: Record<string, unknown> = {};
    for (const row of rows) {
      if (['fileCount', 'symbolCount', 'relationCount', 'chunkCount', 'vectorCount', 'formatVersion', 'embeddingDimensions', 'indexPart', 'indexPartCount'].includes(row.key)) {
        meta[row.key] = Number(row.value);
      } else {
        meta[row.key] = row.value;
      }
    }
    return meta as Partial<IndexMetadata>;
  }

  insertFilesBatch(files: FileRecord[]): void {
    if (files.length === 0) return;
    const stmt = this.db.prepare('INSERT OR REPLACE INTO files (path, language, hash, size, modifiedAt, terms) VALUES (?, ?, ?, ?, ?, ?)');
    const deleteTerms = this.db.prepare('DELETE FROM file_terms WHERE filePath = ?');
    const insertTerm = this.db.prepare('INSERT OR IGNORE INTO file_terms (filePath, term) VALUES (?, ?)');
    this.db.exec('BEGIN TRANSACTION');
    for (const f of files) {
      stmt.run(f.path, f.language, f.hash, f.size, f.modifiedAt, JSON.stringify(f.terms));
      deleteTerms.run(f.path);
      for (const term of new Set(f.terms.map((value) => value.toLowerCase()))) insertTerm.run(f.path, term);
    }
    this.db.exec('COMMIT');
  }

  insertSymbolsBatch(symbols: SymbolRecord[]): void {
    if (symbols.length === 0) return;
    const stmt = this.db.prepare('INSERT OR REPLACE INTO symbols (id, filePath, name, kind, startLine, endLine, startColumn, endColumn, parentId) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
    this.db.exec('BEGIN TRANSACTION');
    for (const s of symbols) {
      stmt.run(s.id, s.filePath, s.name, s.kind, s.startLine, s.endLine, s.startColumn, s.endColumn, s.parentId ?? null);
    }
    this.db.exec('COMMIT');
  }

  insertRelationsBatch(relations: RelationRecord[]): void {
    if (relations.length === 0) return;
    const stmt = this.db.prepare('INSERT OR REPLACE INTO relations (id, kind, filePath, fromSymbolId, toSymbolId, targetName, normalizedTargetName, line, confidence) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
    this.db.exec('BEGIN TRANSACTION');
    for (const r of relations) {
      stmt.run(r.id, r.kind, r.filePath, r.fromSymbolId ?? null, r.toSymbolId ?? null, r.targetName, normalizeRelationTarget(r.targetName), r.line, r.confidence);
    }
    this.db.exec('COMMIT');
  }

  insertChunksBatch(chunks: CodeChunk[]): void {
    if (chunks.length === 0) return;
    const stmt = this.db.prepare('INSERT OR REPLACE INTO chunks (id, filePath, symbolId, startLine, endLine, hash, text) VALUES (?, ?, ?, ?, ?, ?, ?)');
    this.db.exec('BEGIN TRANSACTION');
    for (const c of chunks) {
      stmt.run(c.id, c.filePath, c.symbolId ?? null, c.startLine, c.endLine, c.hash, c.text);
    }
    this.db.exec('COMMIT');
  }

  insertVectorsBatch(vectors: VectorRecord[]): void {
    if (vectors.length === 0) return;
    const stmt = this.db.prepare('INSERT OR REPLACE INTO vectors (chunkId, chunkHash, providerId, dimensions, "values") VALUES (?, ?, ?, ?, ?)');
    this.db.exec('BEGIN TRANSACTION');
    for (const v of vectors) {
      stmt.run(v.chunkId, v.chunkHash, v.providerId, v.dimensions, JSON.stringify(v.values));
    }
    this.db.exec('COMMIT');
  }

  deleteFileRecords(filePaths: string[]): void {
    if (filePaths.length === 0) return;
    this.db.exec('BEGIN TRANSACTION');
    const delFiles = this.db.prepare('DELETE FROM files WHERE path = ?');
    const delSymbols = this.db.prepare('DELETE FROM symbols WHERE filePath = ?');
    const delTerms = this.db.prepare('DELETE FROM file_terms WHERE filePath = ?');
    const delRelations = this.db.prepare('DELETE FROM relations WHERE filePath = ?');
    const delVectors = this.db.prepare('DELETE FROM vectors WHERE chunkId IN (SELECT id FROM chunks WHERE filePath = ?)');
    const delChunks = this.db.prepare('DELETE FROM chunks WHERE filePath = ?');
    for (const p of filePaths) {
      delFiles.run(p);
      delTerms.run(p);
      delSymbols.run(p);
      delRelations.run(p);
      delVectors.run(p);
      delChunks.run(p);
    }
    this.db.exec('COMMIT');
  }

  /** Revalidates only dangling graph edges, then resolves newly inserted or invalidated relations. */
  resolveRelations(): { invalidated: number; resolved: number } {
    this.db.exec('BEGIN TRANSACTION');
    const before = this.db.prepare('SELECT COUNT(*) AS count FROM relations WHERE toSymbolId IS NULL').get() as { count: number };
    const invalidated = Number(this.db.prepare(`
      UPDATE relations
      SET toSymbolId = NULL, confidence = MIN(confidence, 0.5)
      WHERE toSymbolId IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM symbols s WHERE s.id = relations.toSymbolId)
    `).run().changes);
    this.db.exec(`
      UPDATE relations
      SET toSymbolId = (
        SELECT s.id FROM symbols s
        WHERE s.name = relations.targetName AND s.filePath = relations.filePath
        LIMIT 1
      ),
      confidence = 0.9
      WHERE toSymbolId IS NULL AND kind IN ('calls', 'extends', 'implements', 'contains') AND EXISTS (
        SELECT 1 FROM symbols s WHERE s.name = relations.targetName AND s.filePath = relations.filePath
      );

      UPDATE relations
      SET toSymbolId = (
        SELECT s.id FROM symbols s
        WHERE s.name = relations.targetName
        LIMIT 1
      ),
      confidence = 0.72
      WHERE toSymbolId IS NULL AND kind IN ('calls', 'extends', 'implements', 'contains') AND EXISTS (
        SELECT 1 FROM symbols s WHERE s.name = relations.targetName
      );

      UPDATE relations
      SET toSymbolId = (
        SELECT s.id FROM symbols s
        WHERE s.name = relations.targetName
           OR s.name = relations.normalizedTargetName
           OR s.filePath LIKE '%/' || relations.normalizedTargetName || '.ts'
           OR s.filePath LIKE '%/' || relations.normalizedTargetName || '.js'
        LIMIT 1
      ),
      confidence = 0.72
      WHERE toSymbolId IS NULL AND kind IN ('calls', 'extends', 'implements', 'contains') AND EXISTS (
        SELECT 1 FROM symbols s
        WHERE s.name = relations.targetName
           OR s.name = relations.normalizedTargetName
           OR s.filePath LIKE '%/' || relations.normalizedTargetName || '.ts'
           OR s.filePath LIKE '%/' || relations.normalizedTargetName || '.js'
      );
    `);
    const after = this.db.prepare('SELECT COUNT(*) AS count FROM relations WHERE toSymbolId IS NULL').get() as { count: number };
    this.db.exec('COMMIT');
    return { invalidated, resolved: Math.max(0, Number(before.count) + Number(invalidated) - Number(after.count)) };
  }

  getCounts(): { files: number; symbols: number; relations: number; chunks: number; vectors: number } {
    const files = (this.db.prepare('SELECT COUNT(*) as c FROM files').get() as { c: number }).c;
    const symbols = (this.db.prepare('SELECT COUNT(*) as c FROM symbols').get() as { c: number }).c;
    const relations = (this.db.prepare('SELECT COUNT(*) as c FROM relations').get() as { c: number }).c;
    const chunks = (this.db.prepare('SELECT COUNT(*) as c FROM chunks').get() as { c: number }).c;
    const vectors = (this.db.prepare('SELECT COUNT(*) as c FROM vectors').get() as { c: number }).c;
    return { files, symbols, relations, chunks, vectors };
  }

  *streamFiles(batchSize = 5000): Generator<FileRecord[]> {
    let lastRowId = 0;
    const stmt = this.db.prepare('SELECT rowid, * FROM files WHERE rowid > ? ORDER BY rowid LIMIT ?');
    while (true) {
      const rows = stmt.all(lastRowId, batchSize) as Array<{ rowid: number; path: string; language: string; hash: string; size: number; modifiedAt: number; terms: string }>;
      if (rows.length === 0) break;
      lastRowId = rows.at(-1)!.rowid;
      yield rows.map((r) => ({
        path: r.path,
        language: r.language,
        hash: r.hash,
        size: Number(r.size),
        modifiedAt: Number(r.modifiedAt),
        terms: JSON.parse(r.terms)
      }));
    }
  }

  *streamSymbols(batchSize = 5000): Generator<SymbolRecord[]> {
    let lastRowId = 0;
    const stmt = this.db.prepare('SELECT rowid, * FROM symbols WHERE rowid > ? ORDER BY rowid LIMIT ?');
    while (true) {
      const rows = stmt.all(lastRowId, batchSize) as Array<{ rowid: number; id: string; filePath: string; name: string; kind: string; startLine: number; endLine: number; startColumn: number; endColumn: number; parentId: string | null }>;
      if (rows.length === 0) break;
      lastRowId = rows.at(-1)!.rowid;
      yield rows.map((r) => ({
        id: r.id,
        filePath: r.filePath,
        name: r.name,
        kind: r.kind as any,
        startLine: Number(r.startLine),
        endLine: Number(r.endLine),
        startColumn: Number(r.startColumn),
        endColumn: Number(r.endColumn),
        ...(r.parentId ? { parentId: r.parentId } : {})
      }));
    }
  }

  *streamRelations(batchSize = 5000): Generator<RelationRecord[]> {
    let lastRowId = 0;
    const stmt = this.db.prepare('SELECT rowid, * FROM relations WHERE rowid > ? ORDER BY rowid LIMIT ?');
    while (true) {
      const rows = stmt.all(lastRowId, batchSize) as Array<{ rowid: number; id: string; kind: string; filePath: string; fromSymbolId: string | null; toSymbolId: string | null; targetName: string; line: number; confidence: number }>;
      if (rows.length === 0) break;
      lastRowId = rows.at(-1)!.rowid;
      yield rows.map((r) => ({
        id: r.id,
        kind: r.kind as any,
        filePath: r.filePath,
        ...(r.fromSymbolId ? { fromSymbolId: r.fromSymbolId } : {}),
        ...(r.toSymbolId ? { toSymbolId: r.toSymbolId } : {}),
        targetName: r.targetName,
        line: Number(r.line),
        confidence: Number(r.confidence)
      }));
    }
  }

  *streamChunks(batchSize = 5000): Generator<CodeChunk[]> {
    let lastRowId = 0;
    const stmt = this.db.prepare('SELECT rowid, * FROM chunks WHERE rowid > ? ORDER BY rowid LIMIT ?');
    while (true) {
      const rows = stmt.all(lastRowId, batchSize) as Array<{ rowid: number; id: string; filePath: string; symbolId: string | null; startLine: number; endLine: number; hash: string; text: string }>;
      if (rows.length === 0) break;
      lastRowId = rows.at(-1)!.rowid;
      yield rows.map((r) => ({
        id: r.id,
        filePath: r.filePath,
        ...(r.symbolId ? { symbolId: r.symbolId } : {}),
        startLine: Number(r.startLine),
        endLine: Number(r.endLine),
        hash: r.hash,
        text: r.text
      }));
    }
  }

  *streamVectors(batchSize = 5000): Generator<VectorRecord[]> {
    let lastRowId = 0;
    const stmt = this.db.prepare('SELECT rowid, * FROM vectors WHERE rowid > ? ORDER BY rowid LIMIT ?');
    while (true) {
      const rows = stmt.all(lastRowId, batchSize) as Array<{ rowid: number; chunkId: string; chunkHash: string; providerId: string; dimensions: number; values: string }>;
      if (rows.length === 0) break;
      lastRowId = rows.at(-1)!.rowid;
      yield rows.map((r) => ({
        chunkId: r.chunkId,
        chunkHash: r.chunkHash,
        providerId: r.providerId,
        dimensions: Number(r.dimensions),
        values: JSON.parse(r.values)
      }));
    }
  }

  toSnapshot(): IndexSnapshot {
    const meta = this.getMetadata() as IndexMetadata;
    const files: FileRecord[] = [];
    for (const batch of this.streamFiles(10000)) files.push(...batch);
    const symbols: SymbolRecord[] = [];
    for (const batch of this.streamSymbols(10000)) symbols.push(...batch);
    const relations: RelationRecord[] = [];
    for (const batch of this.streamRelations(10000)) relations.push(...batch);
    const chunks: CodeChunk[] = [];
    for (const batch of this.streamChunks(10000)) chunks.push(...batch);
    const vectors: VectorRecord[] = [];
    for (const batch of this.streamVectors(10000)) vectors.push(...batch);

    return {
      metadata: meta,
      files,
      symbols,
      relations,
      chunks,
      vectors
    };
  }

  close(): void {
    this.db.close();
  }
}

function relationTargetCandidates(targetName: string): string[] {
  const normalized = normalizeRelationTarget(targetName);
  const values = new Set<string>([targetName, normalized]);
  const split = targetName.split(/[\/]/u).filter(Boolean);
  for (const part of split) {
    const cleaned = normalizeRelationTarget(part);
    if (cleaned) values.add(cleaned);
  }
  if (normalized) values.add(normalized.replace(/\.[^/.]+$/u, ''));
  return [...values].filter(Boolean);
}

function normalizeRelationTarget(value: string): string {
  return value
    .replace(/^['"]|['"]$/gu, '')
    .replace(/^\.?\.?\//u, '')
    .replace(/^[A-Za-z]+:/u, '')
    .replace(/[?#].*$/u, '')
    .replace(/\/index$/u, '')
    .replace(/\.[a-z0-9]+$/iu, '')
    .split(/[\\/]+/u).filter(Boolean).at(-1) ?? value
    .replace(/^['"]|['"]$/gu, '');
}
