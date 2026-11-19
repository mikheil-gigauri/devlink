/**
 * Where an npm-compatible registry serves one version's tarball: `<registry>/<name>/-/<base>-<version>.tgz`,
 * where `<base>` is the name without its scope. Installing from this URL needs no registry config at all,
 * which is what Yarn and Bun need, since neither lets a command override a scope's registry.
 */
export function tarballUrl(registryUrl: string, packageName: string, version: string): string {
  const registry = registryUrl.replace(/\/*$/, '/');
  const base = packageName.split('/').at(-1) ?? packageName;
  return `${registry}${packageName}/-/${base}-${version}.tgz`;
}
