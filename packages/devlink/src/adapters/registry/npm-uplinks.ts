import { readFile } from 'node:fs/promises';
import type { ProcessRunner } from '../../core/ports.ts';
import { isRecord, tryParseJson } from '../../core/util/json.ts';
import type { Uplink } from './verdaccio-registry.ts';

/** The registries a developer's npm is configured with, as devlink reads them at start (ADR 0012). */
export interface NpmRegistries {
  /** The default registry, e.g. `https://registry.npmjs.org/`. */
  readonly registry: string;
  /** Scoped registries, e.g. `{ '@corp': 'https://npm.corp.example/' }`. */
  readonly scoped: Readonly<Record<string, string>>;
  /** Raw npmrc settings from the user and global files, including credentials. */
  readonly settings: ReadonlyMap<string, string>;
}

/**
 * Reads the effective registries with `npm config list --json`, then the user and global npmrc files
 * for credentials, which npm redacts from that listing. Credentials stay in memory.
 */
export async function readNpmRegistries(
  runner: ProcessRunner,
  options: { readonly cwd: string; readonly env?: NodeJS.ProcessEnv },
): Promise<NpmRegistries> {
  const result = await runner.run({ command: 'npm', args: ['config', 'list', '--json'], cwd: options.cwd });
  const config = result.exitCode === 0 ? tryParseJson(result.stdout) : undefined;
  const listed = isRecord(config) ? config : {};

  const settings = new Map<string, string>();
  for (const key of ['globalconfig', 'userconfig']) {
    const path = listed[key];
    if (typeof path !== 'string') continue;
    const text = await readFile(path, 'utf8').catch(() => '');
    for (const [name, value] of parseNpmrc(text, options.env ?? process.env)) settings.set(name, value);
  }

  const scoped: Record<string, string> = {};
  for (const [key, value] of Object.entries(listed)) {
    const scope = /^(@[^:]+):registry$/.exec(key)?.[1];
    if (scope !== undefined && typeof value === 'string') scoped[scope] = value;
  }
  const registry = typeof listed.registry === 'string' ? listed.registry : 'https://registry.npmjs.org/';
  return { registry, scoped, settings };
}

/** Parses npmrc text: `key=value` lines, `;` and `#` comments, `${VAR}` expanded from `env`. */
export function parseNpmrc(text: string, env: NodeJS.ProcessEnv): Map<string, string> {
  const settings = new Map<string, string>();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '' || line.startsWith(';') || line.startsWith('#')) continue;
    const equals = line.indexOf('=');
    if (equals === -1) continue;
    const key = line.slice(0, equals).trim();
    const value = line
      .slice(equals + 1)
      .trim()
      .replace(/\$\{([^}?]+)\??\}/g, (_, name: string) => env[name] ?? '');
    settings.set(key, value);
  }
  return settings;
}

/**
 * Turns npm's registries into Verdaccio uplinks: the default registry serves everything, each other
 * registry serves the scopes configured for it. devlink's own registry is never proxied.
 */
export function uplinksFrom(input: NpmRegistries & { readonly ownRegistry: string }): Record<string, Uplink> {
  const own = withSlash(input.ownRegistry);
  const byUrl = new Map<string, { scopes: string[] }>();
  const defaultUrl = withSlash(input.registry);
  if (defaultUrl !== own) byUrl.set(defaultUrl, { scopes: [] });

  for (const [scope, url] of Object.entries(input.scoped)) {
    const normalized = withSlash(url);
    if (normalized === own || normalized === defaultUrl) continue;
    const entry = byUrl.get(normalized) ?? { scopes: [] };
    entry.scopes.push(scope);
    byUrl.set(normalized, entry);
  }

  const uplinks: Record<string, Uplink> = {};
  for (const [url, { scopes }] of byUrl) {
    const auth = credentialsFor(url, input.settings);
    uplinks[uniqueName(url, uplinks)] = {
      url,
      ...(auth && { auth }),
      ...(scopes.length > 0 && { scopes }),
    };
  }
  return uplinks;
}

/** npm keys credentials by the registry URL without its protocol, falling back to parent paths. */
function credentialsFor(url: string, settings: ReadonlyMap<string, string>): Uplink['auth'] {
  const { host, pathname } = new URL(url);
  const segments = pathname.split('/').filter(Boolean);
  for (let depth = segments.length; depth >= 0; depth -= 1) {
    const key = `//${host}/${segments
      .slice(0, depth)
      .map((segment) => `${segment}/`)
      .join('')}`;
    const token = settings.get(`${key}:_authToken`);
    if (token) return { type: 'bearer', token };
    const basic = settings.get(`${key}:_auth`);
    if (basic) return { type: 'basic', token: basic };
    const username = settings.get(`${key}:username`);
    const password = settings.get(`${key}:_password`);
    const pair = username && password ? basicPair(username, password) : undefined;
    if (pair) return { type: 'basic', token: pair };
  }
  return undefined;
}

/** npm stores `_password` base64-encoded. A malformed one is skipped; `doctor` shows the uplink as unauthenticated. */
function basicPair(username: string, password: string): string | undefined {
  try {
    return btoa(`${username}:${atob(password)}`);
  } catch {
    return undefined;
  }
}

function uniqueName(url: string, taken: Readonly<Record<string, unknown>>): string {
  const { hostname, port } = new URL(url);
  const base = `${hostname}${port ? `-${port}` : ''}`.replace(/[^a-z0-9.-]/gi, '-');
  let name = base;
  for (let n = 2; Object.hasOwn(taken, name); n += 1) name = `${base}-${n}`;
  return name;
}

function withSlash(url: string): string {
  return url.endsWith('/') ? url : `${url}/`;
}
