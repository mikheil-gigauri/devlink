import type { DependencyField } from '../../core/model.ts';
import type { PackageManagerAdapter, Publisher } from '../../core/ports.ts';

const QUIET = ['--no-audit', '--no-fund'] as const;

const SAVE_FLAG: Readonly<Record<DependencyField, string | undefined>> = {
  dependencies: undefined,
  devDependencies: '--save-dev',
  optionalDependencies: '--save-optional',
  peerDependencies: '--save-peer',
};

export const npm: PackageManagerAdapter = {
  name: 'npm',
  lockfiles: ['package-lock.json', 'npm-shrinkwrap.json'],

  install({ cwd, packageName, version, dependencyField, registryUrl }) {
    const saveFlag = SAVE_FLAG[dependencyField];
    return {
      command: 'npm',
      args: [
        'install',
        `${packageName}@${version}`,
        '--save-exact',
        ...(saveFlag === undefined ? [] : [saveFlag]),
        registryFlag(packageName, registryUrl),
        ...QUIET,
      ],
      cwd,
    };
  },

  cleanInstall({ cwd, hasLockfile }) {
    // Without a lockfile, a plain install must not create one, or the restore would not be exact.
    const args = hasLockfile ? ['ci', ...QUIET] : ['install', '--no-package-lock', ...QUIET];
    return { command: 'npm', args, cwd };
  },
};

/** Publishes every library, whichever package manager it uses: the staged folder is a plain package. */
export const npmPublisher: Publisher = {
  publish({ cwd, packageName, registryUrl, tag }) {
    // A user's `@scope:registry` beats `--registry` for a scoped package, so a dev build would go to
    // that registry, often the public one. Pinning the scope too keeps it on the local registry.
    const scope = scopeOf(packageName);
    return {
      command: 'npm',
      args: [
        'publish',
        `--registry=${registryUrl}`,
        ...(scope === undefined ? [] : [`--${scope}:registry=${registryUrl}`]),
        `--tag=${tag}`,
        '--provenance=false',
      ],
      cwd,
    };
  },

  publishAuthFiles({ registryUrl, credentials }) {
    // npm keys auth by registry URL without the protocol, always ending in a slash.
    const key = registryUrl.replace(/^https?:/, '').replace(/\/*$/, '/');
    const auth = btoa(`${credentials.username}:${credentials.password}`);
    return { '.npmrc': `${key}:_auth=${auth}\n` };
  },
};

/**
 * A scoped package can be pointed at the local registry on its own, leaving every other dependency
 * on the user's normal registry. An unscoped one cannot, so the whole install goes through the local
 * registry, which proxies everything it does not hold (ADR 0002).
 */
function registryFlag(packageName: string, registryUrl: string): string {
  const scope = scopeOf(packageName);
  return scope === undefined ? `--registry=${registryUrl}` : `--${scope}:registry=${registryUrl}`;
}

function scopeOf(packageName: string): string | undefined {
  return /^(@[^/]+)\//.exec(packageName)?.[1];
}
