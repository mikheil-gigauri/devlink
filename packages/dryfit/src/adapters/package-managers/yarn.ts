import type { DependencyField } from '../../core/model.ts';
import type { PackageManagerAdapter } from '../../core/ports.ts';
import { tarballUrl } from './tarball-url.ts';

const SAVE_FLAG: Readonly<Record<DependencyField, string | undefined>> = {
  dependencies: undefined,
  devDependencies: '--dev',
  optionalDependencies: '--optional',
  peerDependencies: '--peer',
};

/** CI sets immutable installs by default, which would refuse the manifest change `add` makes. */
const MUTABLE = { YARN_ENABLE_IMMUTABLE_INSTALLS: 'false' } as const;

/**
 * Yarn 2 and later (Yarn 1 is refused at detection). Yarn reads per-scope registries only from
 * .yarnrc.yml, which dryfit never edits, so the dev build is installed from its tarball URL: that
 * works whatever registry the project maps the scope to, and skips Yarn's release-age gate, which
 * applies to registry versions only. The manifest holds the URL until restore puts it back.
 */
export const yarn: PackageManagerAdapter = {
  name: 'yarn',
  lockfiles: ['yarn.lock'],

  install({ cwd, packageName, version, dependencyField, registryUrl }) {
    const saveFlag = SAVE_FLAG[dependencyField];
    const url = new URL(registryUrl);
    return {
      command: 'yarn',
      args: [
        'add',
        `${packageName}@${tarballUrl(registryUrl, packageName, version)}`,
        ...(saveFlag === undefined ? [] : [saveFlag]),
      ],
      cwd,
      // Yarn refuses plain http except to hosts listed here; the local registry is loopback http.
      env: url.protocol === 'http:' ? { ...MUTABLE, YARN_UNSAFE_HTTP_WHITELIST: url.hostname } : MUTABLE,
    };
  },

  cleanInstall({ cwd, hasLockfile }) {
    return hasLockfile
      ? { command: 'yarn', args: ['install', '--immutable'], cwd }
      : { command: 'yarn', args: ['install'], cwd, env: MUTABLE };
  },
};
