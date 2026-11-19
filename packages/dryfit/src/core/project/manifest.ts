import { DryfitError } from '../errors.ts';
import { DEPENDENCY_FIELDS, type DependencyField, type Manifest } from '../model.ts';
import type { FileSystem } from '../ports.ts';
import { detectIndent, isRecord, tryParseJson } from '../util/json.ts';
import { joinPath } from '../util/path.ts';

export interface LoadedManifest {
  readonly path: string;
  readonly manifest: Manifest;
  /** The file exactly as read, used for snapshots and to preserve formatting on rewrite. */
  readonly text: string;
}

/** Reads `<dir>/package.json`. Throws `invalid-manifest` when it is missing or not a JSON object. */
export async function readManifest(fs: FileSystem, dir: string): Promise<LoadedManifest> {
  const path = joinPath(dir, 'package.json');
  const text = await fs.readText(path);
  if (text === undefined) {
    throw new DryfitError('invalid-manifest', `No package.json found in ${dir}`, { path });
  }

  const parsed = tryParseJson(text);
  if (!isRecord(parsed)) {
    throw new DryfitError('invalid-manifest', `${path} is not a valid JSON object`, { path });
  }
  return { path, manifest: parsed as Manifest, text };
}

/** Serialises a manifest the way npm does, keeping the original file's indentation. */
export function formatManifest(manifest: Manifest, original?: string): string {
  return `${JSON.stringify(manifest, null, original === undefined ? 2 : detectIndent(original))}\n`;
}

export interface DependencyDeclaration {
  readonly field: DependencyField;
  readonly range: string;
}

/**
 * Where a manifest declares a package. Installable fields win over `peerDependencies`, because a
 * library that peers on a package usually also lists it in devDependencies to develop against it.
 */
export function findDependency(manifest: Manifest, packageName: string): DependencyDeclaration | undefined {
  const order = [
    ...DEPENDENCY_FIELDS.filter((field) => field !== 'peerDependencies'),
    'peerDependencies',
  ] as const;

  for (const field of order) {
    const range = manifest[field]?.[packageName];
    if (typeof range === 'string') return { field, range };
  }
  return undefined;
}
