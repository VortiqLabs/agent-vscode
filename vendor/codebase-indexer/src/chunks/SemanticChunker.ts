import { createHash } from 'node:crypto';
import type { CodeChunk } from '../types/CodeChunk.js';

const MAX_CHUNK_CHARACTERS = 4000;
const MAX_CHUNK_LINES = 100;

export class SemanticChunker {
  chunk(filePath: string, source: string): CodeChunk[] {
    const lines = source.split(/\r?\n/u);
    const sections: Array<{ start: number; end: number }> = [];
    let start = 0;
    for (let index = 0; index < lines.length; index++) {
      const heading = /^#{1,6}\s/u.test(lines[index] ?? '');
      const boundary = index > start && (heading || index - start >= MAX_CHUNK_LINES ||
        lines.slice(start, index + 1).join('\n').length > MAX_CHUNK_CHARACTERS);
      if (boundary) {
        sections.push({ start, end: index - 1 });
        start = index;
      } else if (index > start && (lines[index] ?? '').trim() === '' && (lines[index - 1] ?? '').trim() === '') {
        sections.push({ start, end: index - 1 });
        start = index + 1;
      }
    }
    if (start < lines.length) sections.push({ start, end: lines.length - 1 });

    return sections.flatMap(({ start: sectionStart, end }) => {
      const text = lines.slice(sectionStart, end + 1).join('\n').trim();
      if (!text) return [];
      const hash = createHash('sha256').update(text).digest('hex');
      return [{
        id: createHash('sha256').update(`${filePath}:${sectionStart}:${hash}`).digest('hex').slice(0, 24),
        filePath,
        startLine: sectionStart + 1,
        endLine: end + 1,
        hash,
        text
      }];
    });
  }
}