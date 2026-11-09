import { createHash } from 'node:crypto';
import path from 'node:path';
import { runtimePath } from '../runtime/runtime-paths.js';
import { Language, Parser, type Node as SyntaxNode, type Tree } from 'web-tree-sitter';
import type { CodeChunk } from '../types/CodeChunk.js';
import type { RelationRecord } from '../types/Relation.js';
import type { SymbolKind, SymbolRecord } from '../types/Symbol.js';

export interface ParsedFile {
  symbols: SymbolRecord[];
  relations: RelationRecord[];
  chunks: CodeChunk[];
}

const languages = new Map<string, Promise<Language>>();
let initialized: Promise<void> | undefined;
const localGrammars = new Set(['dockerfile', 'elm', 'gitignore', 'make', 'markdown', 'ql', 'sql', 'yaml']);
const grammars: Record<string, string> = {
  bash: 'bash',
  c: 'c',
  cpp: 'cpp',
  csharp: 'c_sharp',
  css: 'css',
  dart: 'dart',
  elisp: 'elisp',
  elm: 'elm',
  elixir: 'elixir',
  dockerfile: 'dockerfile',
  gitignore: 'gitignore',
  go: 'go',
  html: 'html',
  java: 'java',
  javascript: 'javascript',
  json: 'json',
  kotlin: 'kotlin',
  lua: 'lua',
  makefile: 'make',
  markdown: 'markdown',
  objectivec: 'objc',
  ocaml: 'ocaml',
  php: 'php',
  python: 'python',
  ql: 'ql',
  rescript: 'rescript',
  ruby: 'ruby',
  rust: 'rust',
  scala: 'scala',
  solidity: 'solidity',
  sql: 'sql',
  swift: 'swift',
  systemrdl: 'systemrdl',
  tlaplus: 'tlaplus',
  toml: 'toml',
  typescript: 'typescript',
  tsx: 'tsx',
  vue: 'vue',
  yaml: 'yaml',
  zig: 'zig'
};

const symbolKinds: Record<string, SymbolKind> = {
  class_declaration: 'class',
  class_definition: 'class',
  class_specifier: 'class',
  constructor_declaration: 'constructor',
  enum_declaration: 'enum',
  enum_item: 'enum',
  enum_specifier: 'enum',
  function_declaration: 'function',
  function_definition: 'function',
  function_item: 'function',
  interface_declaration: 'interface',
  interface_definition: 'interface',
  method_declaration: 'method',
  method_definition: 'method',
  mod_item: 'module',
  module: 'module',
  namespace_definition: 'namespace',
  namespace_declaration: 'namespace',
  property_declaration: 'property',
  property_definition: 'property',
  struct_item: 'class',
  trait_item: 'interface',
  type_alias_declaration: 'type',
  type_declaration: 'type',
  type_item: 'type',
  variable_declarator: 'variable',
  const_item: 'constant',
  static_item: 'constant'
};

const referenceNodeTypes = new Set(['identifier', 'type_identifier', 'field_identifier', 'namespace_identifier']);
const inheritanceNodeKinds: Record<string, 'extends' | 'implements'> = {
  base_clause: 'extends',
  extends_clause: 'extends',
  extends_type_clause: 'extends',
  implements_clause: 'implements',
  super_interfaces: 'implements',
  superclass: 'extends',
  superclass_clause: 'extends',
  trait_bounds: 'implements'
};

const MAX_PARSE_SIZE = 4 * 1024 * 1024; // 4 MB safety guard against huge source files spiking memory

export class TreeSitterParser {
  private readonly maxParsers: number;
  private readonly availableParsers: Parser[] = [];
  private readonly parserWaiters: Array<(parser: Parser) => void> = [];
  private createdParsers = 0;

  constructor(maxParsers = 2) {
    if (!Number.isInteger(maxParsers) || maxParsers < 1 || maxParsers > 16) {
      throw new RangeError('maxParsers must be an integer between 1 and 16');
    }
    this.maxParsers = maxParsers;
  }

  async parse(filePath: string, source: string, language: string): Promise<ParsedFile | undefined> {
    if (source.length > MAX_PARSE_SIZE) return undefined;
    const grammar = grammarFor(filePath, language);
    if (!grammar) return undefined;
    initialized ??= Parser.init().catch((error: unknown) => {
      initialized = undefined;
      throw error;
    });
    await initialized;
    const lang = await getLanguage(grammar);
    if (!lang) return undefined;
    const parser = await this.acquireParser();
    let tree: Tree | null | undefined;
    try {
      parser.setLanguage(lang);
      tree = parser.parse(source);
      if (!tree) return { symbols: [], relations: [], chunks: [] };
      return extract(tree.rootNode, filePath);
    } catch {
      return undefined;
    } finally {
      tree?.delete();
      this.releaseParser(parser);
    }
  }

  private async acquireParser(): Promise<Parser> {
    const available = this.availableParsers.pop();
    if (available) return available;
    if (this.createdParsers < this.maxParsers) {
      this.createdParsers++;
      try { return new Parser(); }
      catch (error) { this.createdParsers--; throw error; }
    }
    return new Promise((resolve) => this.parserWaiters.push(resolve));
  }

  private releaseParser(parser: Parser): void {
    const waiter = this.parserWaiters.shift();
    if (waiter) waiter(parser);
    else this.availableParsers.push(parser);
  }
}

async function getLanguage(grammar: string): Promise<Language | undefined> {
  let languagePromise = languages.get(grammar);

  if (!languagePromise) {
    languagePromise = (async () => {
      try {
        const wasmPath = localGrammars.has(grammar)
          ? runtimePath('grammars', `${grammar}.wasm`)
          : runtimePath(
              'tree-sitter-wasms',
              `tree-sitter-${grammar}.wasm`
            );

        return await Language.load(path.resolve(wasmPath));
      } catch {
        return undefined as unknown as Language;
      }
    })();

    languages.set(grammar, languagePromise);
  }

  const loaded = await languagePromise;
  return loaded ?? undefined;
}

function grammarFor(filePath: string, language: string): string | undefined {
  if (path.extname(filePath).toLowerCase() === '.tsx') return 'tsx';
  if (path.extname(filePath).toLowerCase() === '.jsx') return 'javascript';
  if (path.extname(filePath).toLowerCase() === '.vue') return 'vue';
  return grammars[language];
}

function extract(root: SyntaxNode, filePath: string): ParsedFile {
  const symbols: SymbolRecord[] = [];
  const relations: RelationRecord[] = [];
  const chunks: CodeChunk[] = [];
  const pending: Array<{ node: SyntaxNode; parentSymbolId?: string }> = [{ node: root }];

  while (pending.length > 0) {
    const current = pending.pop()!;
    const node = current.node;
    const kind = symbolKinds[node.type];
    const name = kind ? symbolName(node) : undefined;
    let parentSymbolId = current.parentSymbolId;

    if (kind && name) {
      const id = stableId(`${filePath}:${kind}:${name}:${node.startIndex}`);
      const symbol: SymbolRecord = {
        id,
        filePath,
        name,
        kind,
        startLine: node.startPosition.row + 1,
        endLine: node.endPosition.row + 1,
        startColumn: node.startPosition.column,
        endColumn: node.endPosition.column,
        ...(parentSymbolId ? { parentId: parentSymbolId } : {})
      };
      symbols.push(symbol);
      if (parentSymbolId) {
        relations.push({
          id: stableId(`${filePath}:contains:${parentSymbolId}:${id}`),
          kind: 'contains',
          filePath,
          fromSymbolId: parentSymbolId,
          toSymbolId: id,
          targetName: name,
          line: symbol.startLine,
          confidence: 1
        });
      }
      if (isExported(node)) {
        relations.push({
          id: stableId(`${filePath}:exports:${id}`),
          kind: 'exports',
          filePath,
          toSymbolId: id,
          targetName: name,
          line: symbol.startLine,
          confidence: 1
        });
      }
      const text = node.text;
      chunks.push({
        id: stableId(`${id}:${createHash('sha256').update(text).digest('hex')}`),
        filePath,
        symbolId: id,
        startLine: symbol.startLine,
        endLine: symbol.endLine,
        hash: createHash('sha256').update(text).digest('hex'),
        text
      });
      parentSymbolId = id;
    }

    if (node.type === 'call_expression' || node.type === 'call') {
      const target = node.childForFieldName('function') ?? node.childForFieldName('name') ?? node.namedChildren[0];
      const targetName = target?.text.split(/[.(]/u).at(-1)?.replace(/\W.*$/u, '');
      if (targetName) {
        relations.push({
          id: stableId(`${filePath}:calls:${node.startIndex}:${targetName}`),
          kind: 'calls',
          filePath,
          ...(current.parentSymbolId ? { fromSymbolId: current.parentSymbolId } : {}),
          targetName,
          line: node.startPosition.row + 1,
          confidence: 0.55
        });
      }
    } else if (['import_statement', 'import_declaration', 'use_declaration', 'include_statement'].includes(node.type)) {
      const targetName = resolveImportTargetName(node);
      if (targetName) {
        relations.push({
          id: stableId(`${filePath}:imports:${node.startIndex}:${targetName}`),
          kind: 'imports',
          filePath,
          ...(current.parentSymbolId ? { fromSymbolId: current.parentSymbolId } : {}),
          targetName,
          line: node.startPosition.row + 1,
          confidence: 0.7
        });
      }
    } else if (inheritanceNodeKinds[node.type]) {
      const relationKind = inheritanceNodeKinds[node.type]!;
      const names = node.descendantsOfType(['identifier', 'type_identifier', 'scoped_type_identifier'])
        .filter((target): target is SyntaxNode => target !== null);
      for (const target of names) {
        relations.push({
          id: stableId(`${filePath}:${relationKind}:${node.startIndex}:${target.startIndex}`),
          kind: relationKind,
          filePath,
          ...(current.parentSymbolId ? { fromSymbolId: current.parentSymbolId } : {}),
          targetName: target.text.split('::').at(-1)!.split('.').at(-1)!,
          line: target.startPosition.row + 1,
          confidence: 0.7
        });
      }
    } else if (referenceNodeTypes.has(node.type) && !isDeclarationName(node)) {
      relations.push({
        id: stableId(`${filePath}:references:${node.startIndex}:${node.text}`),
        kind: 'references',
        filePath,
        ...(current.parentSymbolId ? { fromSymbolId: current.parentSymbolId } : {}),
        targetName: node.text,
        line: node.startPosition.row + 1,
        confidence: 0.45
      });
    }

    for (let index = node.namedChildren.length - 1; index >= 0; index--) {
      pending.push({ node: node.namedChildren[index]!, ...(parentSymbolId ? { parentSymbolId } : {}) });
    }
  }
  return { symbols, relations, chunks };
}

function symbolName(node: SyntaxNode): string | undefined {
  const name = node.childForFieldName('name') ?? node.childForFieldName('declarator');
  if (name) return name.text.replace(/^.*::/u, '').replace(/^.*\./u, '');
  if (node.type === 'variable_declarator') return node.namedChildren[0]?.text;
  return undefined;
}

function isDeclarationName(node: SyntaxNode): boolean {
  const parent = node.parent;
  if (!parent) return false;
  if (parent.childForFieldName('name')?.id === node.id) return true;
  if (parent.type === 'call_expression' && parent.childForFieldName('function')?.id === node.id) return true;
  if (['import_statement', 'import_declaration', 'use_declaration'].includes(parent.type)) return true;
  return false;
}

function isExported(node: SyntaxNode): boolean {
  return /^\s*export\b/u.test(node.text) || ['export_statement', 'export_declaration'].includes(node.parent?.type ?? '');
}

function resolveImportTargetName(node: SyntaxNode): string | undefined {
  const sourceString = node.namedChildren.find((child) => child !== null && (child.type === 'string' || child.type === 'string_literal' || child.type === 'bare_string_literal' || child.type === 'string_fragment'))?.text
    .replace(/^['"]|['"]$/gu, '');
  if (sourceString) return sourceString;

  const sourceField = node.childForFieldName('source');
  if (sourceField) return sourceField.text.replace(/^['"]|['"]$/gu, '');

  return undefined;
}

function stableId(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 24);
}
