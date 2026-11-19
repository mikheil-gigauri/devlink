import { DryfitError } from '../errors.ts';
import type { CoreDeps } from '../ports.ts';
import { requireLibrary, stagingDir } from './shared.ts';

export interface UnregisterLibraryInput {
  readonly library: string;
}

/**
 * Forgets a library. Refused while consumers are linked to it: their only way back to the release is
 * a restore, and restoring is easier to reason about while the library is still known.
 */
export async function unregisterLibrary(
  deps: CoreDeps,
  { library: name }: UnregisterLibraryInput,
): Promise<void> {
  const state = await deps.state.load();
  requireLibrary(state, name);

  const consumers = state.links.filter((link) => link.library === name).map((link) => link.consumer);
  if (consumers.length > 0) {
    throw new DryfitError(
      'library-linked',
      `${name} is still linked into ${consumers.length === 1 ? consumers[0] : `${consumers.length} consumers`}; restore ${consumers.length === 1 ? 'it' : 'them'} first`,
      { library: name, consumers },
    );
  }

  await deps.state.save({ ...state, libraries: state.libraries.filter((library) => library.name !== name) });
  await deps.fs.remove(stagingDir(deps, name));
}
