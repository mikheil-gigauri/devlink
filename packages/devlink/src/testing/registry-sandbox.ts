import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { NodeProcessRunner } from '../adapters/node/node-process-runner.ts';
import { type Uplink, VerdaccioRegistry } from '../adapters/registry/verdaccio-registry.ts';
import type { CommandResult } from '../core/ports.ts';
import { createTempDir } from './temp-dir.ts';

export interface RegistrySandbox {
  /** Root of everything this sandbox writes. */
  readonly dir: string;
  readonly registry: VerdaccioRegistry;
  /** Runs commands with an isolated npm cache and empty user and global configs, ignoring the machine's npmrc files. */
  readonly runner: NodeProcessRunner;
  /** Runs a command and throws with its output when it fails. */
  run(command: string, args: readonly string[], cwd: string): Promise<CommandResult>;
  /** Writes a package folder: a package.json plus any extra files. */
  writePackage(dir: string, manifest: object, files?: Readonly<Record<string, string>>): Promise<string>;
  /** Starts another registry in this sandbox, e.g. one standing in for the public npm registry. */
  startRegistry(name: string, uplinks?: Readonly<Record<string, Uplink>>): Promise<VerdaccioRegistry>;
  dispose(): Promise<void>;
}

/** A package's dist-tags as a registry reports them, e.g. `{ latest: '1.0.0', devlink: '1.0.1-dev.…' }`. */
export async function distTags(
  registry: { readonly url: string },
  name: string,
): Promise<Record<string, string>> {
  const response = await fetch(`${registry.url}${name.replace('/', '%2f')}`);
  const meta = (await response.json()) as { 'dist-tags'?: Record<string, string> };
  return meta['dist-tags'] ?? {};
}

/** A hermetic world for integration tests: real Verdaccio, real npm, nothing shared with the machine. */
export async function createRegistrySandbox(
  options: { readonly uplinks?: Readonly<Record<string, Uplink>> } = {},
): Promise<RegistrySandbox> {
  const temp = await createTempDir('devlink-it-');
  const registries: VerdaccioRegistry[] = [];
  // Empty stand-ins for the user and global npmrc (npm refuses one file for both), so no machine config leaks in.
  const userconfig = join(temp.path, 'user.npmrc');
  const globalconfig = join(temp.path, 'global.npmrc');
  await Promise.all([writeFile(userconfig, ''), writeFile(globalconfig, '')]);

  const runner = new NodeProcessRunner({
    env: {
      npm_config_cache: join(temp.path, 'npm-cache'),
      npm_config_userconfig: userconfig,
      npm_config_globalconfig: globalconfig,
      npm_config_update_notifier: 'false',
      npm_config_fund: 'false',
      npm_config_audit: 'false',
    },
  });

  const startRegistry = async (name: string, uplinks?: Readonly<Record<string, Uplink>>) => {
    const registry = await VerdaccioRegistry.start({
      storage: join(temp.path, name),
      port: 0,
      logLevel: 'fatal',
      ...(uplinks && { uplinks }),
    });
    registries.push(registry);
    return registry;
  };

  const registry = await startRegistry('registry', options.uplinks);

  return {
    dir: temp.path,
    registry,
    runner,
    startRegistry,
    async run(command, args, cwd) {
      const result = await runner.run({ command, args, cwd });
      if (result.exitCode !== 0) {
        throw new Error(`${command} ${args.join(' ')} failed in ${cwd}:\n${result.stderr || result.stdout}`);
      }
      return result;
    },
    async writePackage(dir, manifest, files = {}) {
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);
      for (const [file, content] of Object.entries(files)) {
        await mkdir(join(dir, file, '..'), { recursive: true });
        await writeFile(join(dir, file), content);
      }
      return dir;
    },
    async dispose() {
      await Promise.all(registries.map((entry) => entry.stop()));
      await temp.cleanup();
    },
  };
}
