import path from 'node:path';

export function runtimeRoot(): string {
  // Explicit override — useful for development/testing.
  const configuredRoot = process.env.CODEBASE_INDEXER_RUNTIME_ROOT;

  if (configuredRoot) {
    return path.resolve(configuredRoot);
  }

  // SEA executable:
  // A SEA application has no JavaScript entry-file argument.
  if (process.argv[1] === undefined) {
    return path.dirname(process.execPath);
  }

  // Normal Node execution:
  // `process.argv[1]` is the actual CLI entrypoint.
  //
  // dist/bin/codebase-indexer.js
  //       ↓
  // dist/
  return path.resolve(path.dirname(process.argv[1]), '..');
}

export function runtimePath(...parts: string[]): string {
  return path.join(runtimeRoot(), ...parts);
}