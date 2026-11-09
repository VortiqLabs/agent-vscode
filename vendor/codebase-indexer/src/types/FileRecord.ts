export interface FileRecord {
  path: string;
  language: string;
  hash: string;
  size: number;
  modifiedAt: number;
  terms: string[];
}

export interface ScanError {
  path: string;
  message: string;
}

export interface ScanResult {
  files: FileRecord[];
  errors: ScanError[];
}