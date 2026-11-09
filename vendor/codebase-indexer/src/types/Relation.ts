export type RelationKind =
  | 'imports'
  | 'imported-by'
  | 'exports'
  | 'exported-by'
  | 'calls'
  | 'called-by'
  | 'extends'
  | 'extended-by'
  | 'implements'
  | 'implemented-by'
  | 'references'
  | 'referenced-by'
  | 'contains'
  | 'depends-on'
  | 'dependent-on'
  | 'instantiates'
  | 'overrides'
  | 'overridden-by';

export interface RelationRecord {
  id: string;
  kind: RelationKind;
  filePath: string;
  fromSymbolId?: string;
  toSymbolId?: string;
  targetName: string;
  line: number;
  confidence: number;
}