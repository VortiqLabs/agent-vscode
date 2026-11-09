import { createHash, timingSafeEqual } from 'node:crypto';
import { mkdir, open, readFile, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { decode, encode } from '@msgpack/msgpack';
import {
  INDEX_CHECKSUM_SIZE,
  INDEX_FORMAT_VERSION,
  INDEX_HEADER_SIZE,
  INDEX_MAGIC,
  type IndexSnapshot
} from './IndexFormat.js';
import type { StagingDatabase } from './StagingDatabase.js';

export class IndexFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IndexFormatError';
  }
}

export class IndexWriter {
  static async writeAtomic(filePath: string, snapshot: IndexSnapshot): Promise<void> {
    const uid = Buffer.from(snapshot.metadata.uid, 'utf8');
    if (uid.length > 0xffff) throw new Error('Index UID is too long');
    const payload = Buffer.from(encode(snapshot));
    const header = Buffer.alloc(INDEX_HEADER_SIZE);
    INDEX_MAGIC.copy(header, 0);
    header.writeUInt16BE(INDEX_FORMAT_VERSION, 8);
    header.writeUInt16BE(0, 10);
    header.writeUInt16BE(uid.length, 12);
    header.writeBigUInt64BE(BigInt(payload.length), 14);
    const body = Buffer.concat([header, uid, payload]);
    const checksum = createHash('sha256').update(body).digest();
    const temporaryPath = `${filePath}.tmp`;

    await mkdir(path.dirname(filePath), { recursive: true });
    try {
      const handle = await open(temporaryPath, 'w');
      try {
        await handle.writeFile(Buffer.concat([body, checksum]));
        await handle.sync();
      } finally {
        await handle.close();
      }
      await rename(temporaryPath, filePath);
    } catch (error) {
      await rm(temporaryPath, { force: true });
      throw error;
    }
  }

  static async writeAtomicFromDatabase(filePath: string, db: StagingDatabase): Promise<void> {
    const counts = db.getCounts();
    const meta = db.getMetadata() as import('./IndexFormat.js').IndexMetadata;
    meta.fileCount = counts.files;
    meta.symbolCount = counts.symbols;
    meta.relationCount = counts.relations;
    meta.chunkCount = counts.chunks;
    meta.vectorCount = counts.vectors;

    const uid = Buffer.from(meta.uid, 'utf8');
    if (uid.length > 0xffff) throw new Error('Index UID is too long');

    const temporaryPath = `${filePath}.tmp`;
    const temporaryPayloadPath = `${filePath}.payload.tmp`;

    await mkdir(path.dirname(filePath), { recursive: true });

    try {
      const payloadHandle = await open(temporaryPayloadPath, 'w');
      try {
        await payloadHandle.write(Buffer.from([0x86]));

        await payloadHandle.write(Buffer.from(encode('metadata')));
        await payloadHandle.write(Buffer.from(encode(meta)));

        await payloadHandle.write(Buffer.from(encode('files')));
        await payloadHandle.write(encodeArrayHeader(counts.files));
        for (const batch of db.streamFiles(2000)) {
          const bufs = batch.map((item: unknown) => encode(item));
          await payloadHandle.write(Buffer.concat(bufs));
        }

        await payloadHandle.write(Buffer.from(encode('symbols')));
        await payloadHandle.write(encodeArrayHeader(counts.symbols));
        for (const batch of db.streamSymbols(2000)) {
          const bufs = batch.map((item: unknown) => encode(item));
          await payloadHandle.write(Buffer.concat(bufs));
        }

        await payloadHandle.write(Buffer.from(encode('relations')));
        await payloadHandle.write(encodeArrayHeader(counts.relations));
        for (const batch of db.streamRelations(2000)) {
          const bufs = batch.map((item: unknown) => encode(item));
          await payloadHandle.write(Buffer.concat(bufs));
        }

        await payloadHandle.write(Buffer.from(encode('chunks')));
        await payloadHandle.write(encodeArrayHeader(counts.chunks));
        for (const batch of db.streamChunks(2000)) {
          const bufs = batch.map((item: unknown) => encode(item));
          await payloadHandle.write(Buffer.concat(bufs));
        }

        await payloadHandle.write(Buffer.from(encode('vectors')));
        await payloadHandle.write(encodeArrayHeader(counts.vectors));
        for (const batch of db.streamVectors(2000)) {
          const bufs = batch.map((item: unknown) => encode(item));
          await payloadHandle.write(Buffer.concat(bufs));
        }

        await payloadHandle.sync();
      } finally {
        await payloadHandle.close();
      }

      const payloadStats = await stat(temporaryPayloadPath);
      const payloadLength = BigInt(payloadStats.size);

      const header = Buffer.alloc(INDEX_HEADER_SIZE);
      INDEX_MAGIC.copy(header, 0);
      header.writeUInt16BE(INDEX_FORMAT_VERSION, 8);
      header.writeUInt16BE(0, 10);
      header.writeUInt16BE(uid.length, 12);
      header.writeBigUInt64BE(payloadLength, 14);

      const hash = createHash('sha256');
      hash.update(header);
      hash.update(uid);

      const outHandle = await open(temporaryPath, 'w');
      try {
        await outHandle.write(header);
        await outHandle.write(uid);

        const readPayloadHandle = await open(temporaryPayloadPath, 'r');
        try {
          const chunkSize = 64 * 1024;
          const buffer = Buffer.alloc(chunkSize);
          let bytesRead = 0;
          let position = 0;
          while ((bytesRead = (await readPayloadHandle.read(buffer, 0, chunkSize, position)).bytesRead) > 0) {
            const slice = buffer.subarray(0, bytesRead);
            hash.update(slice);
            await outHandle.write(slice);
            position += bytesRead;
          }
        } finally {
          await readPayloadHandle.close();
        }

        const checksum = hash.digest();
        await outHandle.write(checksum);
        await outHandle.sync();
      } finally {
        await outHandle.close();
      }

      await rm(temporaryPayloadPath, { force: true });
      await rename(temporaryPath, filePath);
    } catch (error) {
      await rm(temporaryPath, { force: true });
      await rm(temporaryPayloadPath, { force: true });
      throw error;
    }
  }
}

function encodeArrayHeader(len: number): Buffer {
  if (len <= 15) return Buffer.from([0x90 | len]);
  if (len <= 0xffff) {
    const buf = Buffer.alloc(3);
    buf[0] = 0xdc;
    buf.writeUInt16BE(len, 1);
    return buf;
  }
  const buf = Buffer.alloc(5);
  buf[0] = 0xdd;
  buf.writeUInt32BE(len, 1);
  return buf;
}

export class IndexReader {
  static async read(filePath: string, expectedUid?: string): Promise<IndexSnapshot> {
    const buffer = await readFile(filePath);
    if (buffer.length < INDEX_HEADER_SIZE + INDEX_CHECKSUM_SIZE) {
      throw new IndexFormatError('Index is truncated');
    }
    if (!buffer.subarray(0, INDEX_MAGIC.length).equals(INDEX_MAGIC)) {
      throw new IndexFormatError('Invalid index magic bytes');
    }
    const version = buffer.readUInt16BE(8);
    if (version !== INDEX_FORMAT_VERSION) {
      throw new IndexFormatError(`Unsupported index format version: ${version}`);
    }
    const uidLength = buffer.readUInt16BE(12);
    const payloadLength = buffer.readBigUInt64BE(14);
    const bodyLength = INDEX_HEADER_SIZE + uidLength + Number(payloadLength);
    if (!Number.isSafeInteger(Number(payloadLength)) || bodyLength + INDEX_CHECKSUM_SIZE !== buffer.length) {
      throw new IndexFormatError('Invalid index section lengths');
    }
    const expectedChecksum = buffer.subarray(bodyLength);
    const actualChecksum = createHash('sha256').update(buffer.subarray(0, bodyLength)).digest();
    if (!timingSafeEqual(expectedChecksum, actualChecksum)) {
      throw new IndexFormatError('Index checksum validation failed');
    }
    const uid = buffer.toString('utf8', INDEX_HEADER_SIZE, INDEX_HEADER_SIZE + uidLength);
    if (expectedUid !== undefined && uid !== expectedUid) {
      throw new IndexFormatError(`Index UID mismatch: expected ${expectedUid}, found ${uid}`);
    }
    let value: unknown;
    try {
      value = decode(buffer.subarray(INDEX_HEADER_SIZE + uidLength, bodyLength));
    } catch {
      throw new IndexFormatError('Index payload could not be decoded');
    }
    if (!isIndexSnapshot(value) || value.metadata.uid !== uid) {
      throw new IndexFormatError('Index payload does not match its header');
    }
    return value;
  }
}

function isIndexSnapshot(value: unknown): value is IndexSnapshot {
  if (typeof value !== 'object' || value === null) return false;
  const snapshot = value as Partial<IndexSnapshot>;
  return typeof snapshot.metadata === 'object' && snapshot.metadata !== null &&
    typeof snapshot.metadata.uid === 'string' && Array.isArray(snapshot.files) &&
    Array.isArray(snapshot.symbols) && Array.isArray(snapshot.relations) &&
    Array.isArray(snapshot.chunks) && Array.isArray(snapshot.vectors);
}
