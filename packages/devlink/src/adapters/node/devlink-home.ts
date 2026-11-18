import { randomBytes, randomUUID } from 'node:crypto';
import { chmod, link, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { DevlinkError } from '../../core/errors.ts';
import { isRecord } from '../../core/util/json.ts';

export interface DevlinkConfig {
  /** Folders searched for consumers. */
  readonly roots: readonly string[];
  readonly ports: { readonly api: number; readonly registry: number };
}

/** Fixed ports keep lockfile URLs and the launchd agent stable; 4873 is Verdaccio's own default. */
export const DEFAULT_CONFIG: DevlinkConfig = { roots: [], ports: { api: 4875, registry: 4874 } };

/** What a running daemon publishes about itself, so clients can find and check it. */
export interface DaemonInfo {
  readonly pid: number;
  readonly port: number;
  readonly version: string;
  readonly registryUrl: string;
  readonly startedAt: string;
}

/**
 * devlink's folder (`~/.devlink`, or `$DEVLINK_HOME`), shared by the daemon and the CLI (ADR 0012).
 * The folder is private to the user: it holds the API token and copies of consumers' manifests.
 */
export class DevlinkHome {
  readonly root: string;
  readonly paths: {
    readonly config: string;
    readonly state: string;
    readonly token: string;
    readonly daemon: string;
    readonly registry: string;
    readonly logs: string;
    readonly log: string;
  };

  constructor(root: string) {
    this.root = root;
    this.paths = {
      config: join(root, 'config.json'),
      state: join(root, 'state.json'),
      token: join(root, 'token'),
      daemon: join(root, 'daemon.json'),
      registry: join(root, 'registry'),
      logs: join(root, 'logs'),
      log: join(root, 'logs', 'daemon.log'),
    };
  }

  static locate(env: NodeJS.ProcessEnv = process.env, home: string = homedir()): DevlinkHome {
    return new DevlinkHome(env.DEVLINK_HOME || join(home, '.devlink'));
  }

  async ensure(): Promise<void> {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    await chmod(this.root, 0o700);
  }

  async readConfig(): Promise<DevlinkConfig> {
    const text = await readOptional(this.paths.config);
    if (text === undefined) return DEFAULT_CONFIG;

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw this.#invalidConfig('is not valid JSON');
    }
    if (!isRecord(parsed)) throw this.#invalidConfig('must hold a JSON object');
    const roots = parsed.roots ?? DEFAULT_CONFIG.roots;
    if (!Array.isArray(roots) || !roots.every((root) => typeof root === 'string' && root.startsWith('/'))) {
      throw this.#invalidConfig('needs "roots" to be a list of absolute paths');
    }
    const ports = { ...DEFAULT_CONFIG.ports, ...(isRecord(parsed.ports) ? parsed.ports : {}) };
    for (const [name, port] of Object.entries(ports)) {
      if (!Number.isInteger(port) || (port as number) < 0 || (port as number) > 65_535) {
        throw this.#invalidConfig(`has an invalid "ports.${name}"`);
      }
    }
    return { roots, ports: ports as DevlinkConfig['ports'] };
  }

  async writeConfig(config: DevlinkConfig): Promise<void> {
    await this.ensure();
    await writeAtomically(this.paths.config, `${JSON.stringify(config, null, 2)}\n`);
  }

  /**
   * The API token, created on first use. Every client must present it (ADR 0003). The file is written
   * in full under a temporary name and then linked into place, so no reader ever sees a half-written
   * token; a damaged one is replaced.
   */
  async ensureToken(): Promise<string> {
    await this.ensure();
    const existing = await this.readToken();
    if (existing) return existing;

    const token = randomBytes(32).toString('hex');
    const temporary = `${this.paths.token}.${randomUUID()}`;
    await writeFile(temporary, `${token}\n`, { mode: 0o600 });
    try {
      await link(temporary, this.paths.token);
      return token;
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error;
      // Another process got there first, and theirs wins; a damaged file does not.
      const theirs = await this.readToken();
      if (theirs) return theirs;
      await rename(temporary, this.paths.token);
      return token;
    } finally {
      await rm(temporary, { force: true });
    }
  }

  async readToken(): Promise<string | undefined> {
    const token = (await readOptional(this.paths.token))?.trim();
    return token && /^[0-9a-f]{64}$/.test(token) ? token : undefined;
  }

  async writeDaemonInfo(info: DaemonInfo): Promise<void> {
    await this.ensure();
    await writeAtomically(this.paths.daemon, `${JSON.stringify(info, null, 2)}\n`);
  }

  async readDaemonInfo(): Promise<DaemonInfo | undefined> {
    const text = await readOptional(this.paths.daemon);
    try {
      const info = text === undefined ? undefined : (JSON.parse(text) as unknown);
      return isRecord(info) && typeof info.pid === 'number' && typeof info.port === 'number'
        ? (info as unknown as DaemonInfo)
        : undefined;
    } catch {
      return undefined;
    }
  }

  /** Removes the record, but only if it still describes `pid`: a newer daemon may have replaced it. */
  async removeDaemonInfo(pid: number): Promise<void> {
    if ((await this.readDaemonInfo())?.pid === pid) await rm(this.paths.daemon, { force: true });
  }

  #invalidConfig(problem: string): DevlinkError {
    return new DevlinkError('invalid-config', `${this.paths.config} ${problem}`, { path: this.paths.config });
  }
}

async function readOptional(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined;
    throw error;
  }
}

async function writeAtomically(path: string, content: string): Promise<void> {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, content, { mode: 0o600 });
    await rename(temporary, path);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}
