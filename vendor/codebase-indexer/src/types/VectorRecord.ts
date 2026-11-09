export interface VectorRecord {
  chunkId: string;
  chunkHash: string;
  providerId: string;
  dimensions: number;
  values: number[];
}