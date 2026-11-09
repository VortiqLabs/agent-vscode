export interface CodeChunk {
  id: string;
  filePath: string;
  symbolId?: string;
  startLine: number;
  endLine: number;
  hash: string;
  text: string;
}