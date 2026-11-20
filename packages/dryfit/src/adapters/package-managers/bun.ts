import type { DependencyField } from '../../core/model.ts';
import type { PackageManagerAdapter } from '../../core/ports.ts';
import { saveFlag } from './install-args.ts';
import { tarballUrl } from './tarball-url.ts';

const SAVE_FLAG: Readonly<Record<DependencyField, string | undefined>> = {
  dependencies: undefined,
  devDependencies: '--dev',
  optionalDependencies: '--optional',
  peerDependencies: '--peer',
};

/**
 * Bun with its text lockfile (a binary bun.lockb is refused at detection). `--registry` does not
 * override a scope mapped in .npmrc or bunfig.toml, so the dev build is installed from its tarball
 * URL, as with Yarn. The manifest holds the URL until restore puts it back.
 */
export const bun: PackageManagerAdapter = {
  name: 'bun',
  lockfiles: ['bun.lock'],

  install({ cwd, packages, registryUrl }) {
    return {
      command: 'bun',
      args: [
        'add',
        ...packages.map((pkg) => `${pkg.name}@${tarballUrl(registryUrl, pkg.name, pkg.version)}`),
        ...saveFlag(packages, SAVE_FLAG),
      ],
      cwd,
    };
  },

  cleanInstall({ cwd, hasLockfile }) {
    const args = hasLockfile ? ['install', '--frozen-lockfile'] : ['install', '--no-save'];
    return { command: 'bun', args, cwd };
  },
};
