import type { DependencyField } from '../../core/model.ts';
import type { PackageManagerAdapter, RegistryLeak } from '../../core/ports.ts';
import { isRecord, tryParseJson } from '../../core/util/json.ts';
import { isDevVersion } from '../../core/version/dev-version.ts';

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

  publish({ cwd, registryUrl, tag }) {
    return {
      command: 'npm',
      args: ['publish', `--registry=${registryUrl}`, `--tag=${tag}`, '--provenance=false'],
      cwd,
    };
  },

  publishAuthFiles({ registryUrl, credentials }) {
    // npm keys auth by registry URL without the protocol, always ending in a slash.
    const key = registryUrl.replace(/^https?:/, '').replace(/\/*$/, '/');
    const auth = btoa(`${credentials.username}:${credentials.password}`);
    return { '.npmrc': `${key}:_auth=${auth}\n` };
  },

  findRegistryLeaks(lockfile, registryUrl) {
    const registry = registryUrl.replace(/\/+$/, '');
    const parsed = tryParseJson(lockfile);

    if (!isRecord(parsed) || !isRecord(parsed.packages)) {
      // Unparseable (often mid-merge-conflict): a plain text scan is still a useful guard.
      return lockfile.includes(registry)
        ? [{ location: 'package-lock.json', reasons: ['local-registry-url'] }]
        : [];
    }

    const leaks: RegistryLeak[] = [];
    for (const [location, entry] of Object.entries(parsed.packages)) {
      if (!isRecord(entry)) continue;
      const reasons: RegistryLeak['reasons'][number][] = [];
      if (typeof entry.resolved === 'string' && entry.resolved.startsWith(`${registry}/`)) {
        reasons.push('local-registry-url');
      }
      if (typeof entry.version === 'string' && isDevVersion(entry.version)) {
        reasons.push('dev-version');
      }
      if (reasons.length > 0) leaks.push({ location, reasons });
    }
    return leaks;
  },
};

/**
 * A scoped package can be pointed at the local registry on its own, leaving every other dependency
 * on the user's normal registry. An unscoped one cannot, so the whole install goes through the local
 * registry, which proxies everything it does not hold (ADR 0002).
 */
function registryFlag(packageName: string, registryUrl: string): string {
  const scope = /^(@[^/]+)\//.exec(packageName)?.[1];
  return scope === undefined ? `--registry=${registryUrl}` : `--${scope}:registry=${registryUrl}`;
}
