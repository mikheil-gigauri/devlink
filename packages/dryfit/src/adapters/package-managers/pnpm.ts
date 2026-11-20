import type { DependencyField } from '../../core/model.ts';
import type { PackageManagerAdapter } from '../../core/ports.ts';
import { registrySettings, saveFlag } from './install-args.ts';

const SAVE_FLAG: Readonly<Record<DependencyField, string | undefined>> = {
  dependencies: undefined,
  devDependencies: '--save-dev',
  optionalDependencies: '--save-optional',
  peerDependencies: '--save-peer',
};

/**
 * pnpm takes registries as `--config.<key>` for one command, so, like npm, only the libraries' scopes
 * are pointed at the local registry. `minimumReleaseAge` is lifted for that one install: a dev build
 * is always seconds old, and pnpm would otherwise refuse it or record an exception in the project's
 * pnpm-workspace.yaml.
 */
export const pnpm: PackageManagerAdapter = {
  name: 'pnpm',
  lockfiles: ['pnpm-lock.yaml'],

  install({ cwd, packages, registryUrl }) {
    return {
      command: 'pnpm',
      args: [
        'add',
        ...packages.map((pkg) => `${pkg.name}@${pkg.version}`),
        '--save-exact',
        ...saveFlag(packages, SAVE_FLAG),
        ...registrySettings(packages, registryUrl, (scope) =>
          scope === undefined ? '--config.registry' : `--config.${scope}:registry`,
        ),
        '--config.minimumReleaseAge=0',
      ],
      cwd,
    };
  },

  cleanInstall({ cwd, hasLockfile }) {
    const args = hasLockfile ? ['install', '--frozen-lockfile'] : ['install', '--config.lockfile=false'];
    return { command: 'pnpm', args, cwd };
  },
};
