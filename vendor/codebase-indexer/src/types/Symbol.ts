export type SymbolKind = 'function' | 'method' | 'class' | 'interface' | 'type' | 'enum' | 'variable' | 'constant' | 'module' | 'namespace' | 'constructor' | 'property';

export interface SymbolRecord {
  id: string;
  filePath: string;
  name: string;
  kind: SymbolKind;
  startLine: number;
  endLine: number;
  startColumn: number;
  endColumn: number;
  parentId?: string;
}