export type QueryIntentKind = 'symbol' | 'definition' | 'reference' | 'caller' | 'callee' | 'dependency' | 'architecture' | 'semantic' | 'history' | 'test' | 'api' | 'configuration';

export interface QueryIntent {
  kind: QueryIntentKind;
  confidence: number;
  normalized: string;
  reasons: string[];
}

export function classifyQuery(query: string): QueryIntent {
  const normalized = query.trim();
  if (!normalized) {
    return { kind: 'semantic', confidence: 0.2, normalized, reasons: ['Empty query'] };
  }
  const lower = normalized.toLowerCase();

  if (/\bwho\s+calls\b|\bcalls?\s+.*\?|\bcallers?\b|\bcalled\s+by\b|\binvoked\s+by\b/u.test(lower)) {
    return { kind: 'caller', confidence: 0.95, normalized: lower, reasons: ['Caller-focused phrasing'] };
  }
  if (/\bwhat\s+(calls|calls\s+.*)|\bcallee|\bcalled\s+from\b|\bwho\s+is\s+called\b/u.test(lower)) {
    return { kind: 'callee', confidence: 0.9, normalized: lower, reasons: ['Callee-focused phrasing'] };
  }
  if (/\bwhere\s+is\b|\bwhat\s+is\b|\bshow\s+.*symbol|\bfind\s+.*class|\bfind\s+.*function|\bdefinition\b/u.test(lower)) {
    return { kind: 'definition', confidence: 0.82, normalized: lower, reasons: ['Definition lookup phrasing'] };
  }
  if (/\breference|\breferences?\b|\bused\s+by\b|\bimports?\b/u.test(lower)) {
    return { kind: 'reference', confidence: 0.8, normalized: lower, reasons: ['Reference-focused phrasing'] };
  }
  if (/\bdependency|\bdepends\s+on|\bimports?\b|\bpackage\b|\bmodule\b/u.test(lower)) {
    return { kind: 'dependency', confidence: 0.8, normalized: lower, reasons: ['Dependency phrasing'] };
  }
  if (/\barchitecture|\bservice\s+map|\bhow\s+.*works|\brepository\s+structure|\bmodule\s+layout\b/u.test(lower)) {
    return { kind: 'architecture', confidence: 0.84, normalized: lower, reasons: ['Architecture phrasing'] };
  }
  if (/\btest|\bpytest|\bjest|\bvitest|\bcoverage|\baffected\s+tests\b/u.test(lower)) {
    return { kind: 'test', confidence: 0.85, normalized: lower, reasons: ['Test-focused phrasing'] };
  }
  if (/\bapi|\bendpoint|\broute|\bpost\s+\/|\bget\s+\/|\bcontroller\b/u.test(lower)) {
    return { kind: 'api', confidence: 0.88, normalized: lower, reasons: ['API-focused phrasing'] };
  }
  if (/\bconfig|\bpackage\.json|\btsconfig|\bdotenv|\bsettings|\benv\b|\bbuild\b/u.test(lower)) {
    return { kind: 'configuration', confidence: 0.82, normalized: lower, reasons: ['Configuration phrasing'] };
  }
  if (/\bhistory|\bcommit|\bchanged|\brecent\b|\bcochange\b/u.test(lower)) {
    return { kind: 'history', confidence: 0.86, normalized: lower, reasons: ['History-focused phrasing'] };
  }
  return { kind: 'symbol', confidence: 0.65, normalized: lower, reasons: ['Default symbol lookup'] };
}
