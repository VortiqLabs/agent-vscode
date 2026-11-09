import type { CodeChunk } from '../types/CodeChunk.js';
import type { RelationRecord } from '../types/Relation.js';
import type { SymbolRecord } from '../types/Symbol.js';
import type { VectorRecord } from '../types/VectorRecord.js';

export const INDEX_MAGIC = Buffer.from('CBIDX\0\r\n', 'ascii');
export const INDEX_FORMAT_VERSION = 1;
export const INDEX_HEADER_SIZE = 22;
export const INDEX_CHECKSUM_SIZE = 32;

export interface IndexMetadata {
  uid: string;
  workspaceRoot: string;
  formatVersion: number;
  indexerVersion: string;
  createdAt: string;
  updatedAt: string;
  fileCount: number;
  symbolCount: number;
  relationCount: number;
  chunkCount: number;
  vectorCount: number;
  configurationHash: string;
  embeddingProvider?: string;
  embeddingDimensions?: number;
  indexLabel?: string;
  indexGroup?: string;
  indexPart?: number;
  indexPartCount?: number;
}

export interface IndexSnapshot {
  metadata: IndexMetadata;
  files: import('../types/FileRecord.js').FileRecord[];
  symbols: SymbolRecord[];
  relations: RelationRecord[];
  chunks: CodeChunk[];
  vectors: VectorRecord[];
}