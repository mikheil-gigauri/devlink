import { DryfitError } from '../errors.ts';
import type { LibraryRecord } from '../model.ts';
import type { CoreDeps } from '../ports.ts';
import { readManifest } from '../project/manifest.ts';
import { joinPath } from '../util/path.ts';
import { withLibrary } from './shared.ts';

export interface RegisterLibraryInput {
  /** Folder holding the library's source package.json. */
  readonly root: string;
  /** Folder to publish, absolute or relative to `root`. Defaults to `root`. */
  readonly publishDir?: string | undefined;
  /** Command that builds `publishDir`, run in `root`. */
  readonly build?: { readonly command: string; readonly args: readonly string[] } | undefined;
}

/** Adds a library, or updates its paths while keeping its publish history. */
export async function registerLibrary(deps: CoreDeps, input: RegisterLibraryInput): Promise<LibraryRecord> {
  const root = joinPath(input.root);
  const { manifest, path } = await readManifest(deps.fs, root);
  if (typeof manifest.name !== 'string' || manifest.name.length === 0) {
    throw new DryfitError('invalid-manifest', `${path} has no "name", so it cannot be published`, { path });
  }

  const state = await deps.state.load();
  const existing = state.libraries.find((library) => library.name === manifest.name);
  const library: LibraryRecord = {
    name: manifest.name,
    root,
    publishDir: resolvePublishDir(root, input.publishDir),
    build: input.build && { ...input.build, cwd: root },
    lastPublishedVersion: existing?.lastPublishedVersion,
    watch: existing?.watch,
  };

  await deps.state.save(withLibrary(state, library));
  return library;
}

function resolvePublishDir(root: string, publishDir: string | undefined): string {
  if (publishDir === undefined) return root;
  return publishDir.startsWith('/') ? joinPath(publishDir) : joinPath(root, publishDir);
}
