import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import { DevlinkError } from '../../core/errors.ts';
import { type DevlinkState, EMPTY_STATE, type LibraryRecord, type LinkRecord } from '../../core/model.ts';
import type { StateStore } from '../../core/ports.ts';
import { isRecord } from '../../core/util/json.ts';

const STATE_VERSION = 1;

/**
 * devlink's state as one JSON file (`~/.devlink/state.json`). Writes go to a temporary file that is
 * renamed over the old one, so a crash mid-write never leaves a half-written state behind.
 */
export class JsonStateStore implements StateStore {
  readonly #path: string;

  constructor(path: string) {
    this.#path = path;
  }

  async load(): Promise<DevlinkState> {
    let text: string;
    try {
      text = await readFile(this.#path, 'utf8');
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return EMPTY_STATE;
      throw error;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw this.#corrupt('is not valid JSON');
    }
    if (!isRecord(parsed) || parsed.version !== STATE_VERSION) {
      throw this.#corrupt(`has an unknown format version (this devlink reads version ${STATE_VERSION})`);
    }
    const { libraries, links } = parsed;
    if (!Array.isArray(libraries) || !Array.isArray(links)) {
      throw this.#corrupt('is missing its libraries or links');
    }
    if (!libraries.every(isLibraryRecord)) throw this.#corrupt('has a malformed library entry');
    if (!links.every(isLinkRecord)) throw this.#corrupt('has a malformed link entry');
    return { libraries, links };
  }

  async save(state: DevlinkState): Promise<void> {
    await mkdir(dirname(this.#path), { recursive: true });
    const temporary = `${this.#path}.${randomUUID()}.tmp`;
    const content = `${JSON.stringify({ version: STATE_VERSION, ...state }, null, 2)}\n`;
    try {
      // Flushed before the rename, so a power loss cannot leave the new name pointing at empty data.
      const file = await open(temporary, 'w', 0o600);
      try {
        await file.writeFile(content, 'utf8');
        await file.sync();
      } finally {
        await file.close();
      }
      await rename(temporary, this.#path);
    } catch (error) {
      await rm(temporary, { force: true });
      throw error;
    }
  }

  #corrupt(problem: string): DevlinkError {
    return new DevlinkError(
      'state-corrupt',
      `${this.#path} ${problem}. Move it aside to start fresh; your consumers' snapshots are kept separately.`,
      { path: this.#path },
    );
  }
}

const LINK_STATUSES: readonly unknown[] = ['pending', 'installed', 'failed'] satisfies LinkRecord['status'][];

function isLibraryRecord(value: unknown): value is LibraryRecord {
  return (
    isRecord(value) &&
    typeof value.name === 'string' &&
    typeof value.root === 'string' &&
    typeof value.publishDir === 'string'
  );
}

function isLinkRecord(value: unknown): value is LinkRecord {
  return (
    isRecord(value) &&
    typeof value.library === 'string' &&
    typeof value.consumer === 'string' &&
    LINK_STATUSES.includes(value.status)
  );
}
