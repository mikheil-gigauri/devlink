import type { DependencyField } from '../core/model.ts';
import type { InstallSpec } from '../core/ports.ts';

export const DEV_VERSION = '1.4.1-dev.20261118143201';

/** An install of dev builds into `/apps/shop`, each given as a name or `[name, field]`. */
export function installSpec(
  packages: readonly (string | readonly [string, DependencyField])[],
  registryUrl = 'http://127.0.0.1:4873/',
): InstallSpec {
  return {
    cwd: '/apps/shop',
    registryUrl,
    packages: packages.map((entry) => {
      const [name, dependencyField] = typeof entry === 'string' ? [entry, 'dependencies' as const] : entry;
      return { name, version: DEV_VERSION, dependencyField };
    }),
  };
}
