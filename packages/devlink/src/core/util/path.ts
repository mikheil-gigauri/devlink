/**
 * Minimal POSIX path helpers so core/ stays free of `node:path` (ADR 0008). Every segment after the
 * first is treated as relative; `..` cannot climb above the root.
 */
export function joinPath(first: string, ...rest: readonly string[]): string {
  const absolute = first.startsWith('/');
  const segments: string[] = [];

  for (const part of [first, ...rest]) {
    for (const segment of part.split('/')) {
      if (segment === '' || segment === '.') continue;
      if (segment === '..') {
        if (segments.length > 0 && segments.at(-1) !== '..') segments.pop();
        else if (!absolute) segments.push('..');
        continue;
      }
      segments.push(segment);
    }
  }

  const joined = segments.join('/');
  return absolute ? `/${joined}` : joined;
}

/**
 * A single folder name for per-item storage (snapshots, staging). The readable part helps when
 * browsing `~/.devlink`; the hash keeps two inputs from sharing a folder when their readable parts
 * collide (`/a/b_c` and `/a/b/c`).
 */
export function pathSlug(value: string): string {
  const readable = value
    .replace(/^[/@]+/, '')
    .replace(/[^A-Za-z0-9.-]+/g, '_')
    .slice(0, 80);
  return `${readable}-${fnv1a(value)}`;
}

/** 32-bit FNV-1a, hex. Not cryptographic; only needs to separate local paths. */
function fnv1a(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
