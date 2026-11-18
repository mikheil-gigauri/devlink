import { chmod, mkdir, stat } from 'node:fs/promises';
import { request } from 'node:http';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTempDir } from '../../testing/temp-dir.ts';
import { VerdaccioRegistry } from './verdaccio-registry.ts';

/** A raw request, so tests can set headers fetch() would refuse to (Host) or add on its own. */
function send(
  url: string,
  options: { method?: string; headers?: Record<string, string>; body?: string } = {},
) {
  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    const req = request(url, { method: options.method ?? 'GET', headers: options.headers }, (res) => {
      let body = '';
      res.setEncoding('utf8').on('data', (chunk) => (body += chunk));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
    });
    req.on('error', reject);
    req.end(options.body);
  });
}

const basic = (registry: VerdaccioRegistry) => {
  const { username, password } = registry.credentials;
  return { authorization: `Basic ${btoa(`${username}:${password}`)}` };
};

describe('VerdaccioRegistry', () => {
  let storage: string;
  let cleanup: () => Promise<void>;
  const running: VerdaccioRegistry[] = [];

  beforeEach(async () => {
    ({ path: storage, cleanup } = await createTempDir());
  });
  afterEach(async () => {
    await Promise.all(running.splice(0).map((registry) => registry.stop()));
    await cleanup();
  });

  const start = async (port = 0) => {
    const registry = await VerdaccioRegistry.start({ storage, port, logLevel: 'fatal' });
    running.push(registry);
    return registry;
  };

  it('serves on the loopback address with a trailing-slash URL', async () => {
    const registry = await start();

    expect(registry.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/);
    expect((await send(`${registry.url}-/ping`)).status).toBe(200);
  });

  it('issues credentials that authenticate as devlink', async () => {
    const registry = await start();

    const whoami = await send(`${registry.url}-/whoami`, { headers: basic(registry) });

    expect(registry.credentials.username).toBe('devlink');
    expect(whoami.status).toBe(200);
    expect(JSON.parse(whoami.body)).toEqual({ username: 'devlink' });
  });

  it('refuses to register any other user, so nobody else can obtain publish rights', async () => {
    const registry = await start();

    const signup = await send(`${registry.url}-/user/org.couchdb.user:mallory`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'mallory', password: 'hunter2hunter2' }),
    });

    expect(signup.status).toBe(409);
    expect(signup.body).not.toContain('token');
  });

  it('keeps its storage, which holds the token-signing secret, private to the current user', async () => {
    await chmod(storage, 0o755);
    const nested = join(storage, 'nested', 'registry');
    await mkdir(join(storage, 'nested'), { mode: 0o755 });

    const registry = await VerdaccioRegistry.start({ storage: nested, port: 0, logLevel: 'fatal' });
    running.push(registry);
    await start();

    expect((await stat(nested)).mode & 0o777).toBe(0o700);
    expect((await stat(storage)).mode & 0o777).toBe(0o700);
  });

  it('refuses to publish without credentials', async () => {
    const registry = await start();

    expect((await send(`${registry.url}@acme%2fui`, { method: 'PUT' })).status).toBe(401);
  });

  it('refuses any request a browser makes, so web pages cannot read private dev builds', async () => {
    const registry = await start();

    const crossOrigin = await send(`${registry.url}-/ping`, { headers: { origin: 'https://evil.example' } });
    const rebound = await send(`${registry.url}-/ping`, { headers: { host: 'evil.example' } });

    expect([crossOrigin.status, rebound.status]).toEqual([403, 403]);
  });

  it('accepts localhost as a host name', async () => {
    const registry = await start();
    const port = new URL(registry.url).port;

    expect((await send(`${registry.url}-/ping`, { headers: { host: `localhost:${port}` } })).status).toBe(
      200,
    );
  });

  it('restarts on the same storage with fresh credentials, and the old ones stop working', async () => {
    const first = await start();
    const stale = basic(first);
    await first.stop();
    running.splice(0);

    const second = await start();
    const fresh = await send(`${second.url}-/whoami`, { headers: basic(second) });
    const old = await send(`${second.url}-/whoami`, { headers: stale });

    expect(fresh.status).toBe(200);
    expect(old.status).toBe(401);
  });

  it('proxies a private registry with credentials, for the scopes it serves', async () => {
    const { path: privateStorage, cleanup: cleanPrivate } = await createTempDir();
    const corp = await VerdaccioRegistry.start({
      storage: privateStorage,
      port: 0,
      logLevel: 'fatal',
      requireAuthToRead: true,
    });
    running.push(corp);
    const tarball = Buffer.from('not really a tarball').toString('base64');
    const published = await send(`${corp.url}@corp%2ftokens`, {
      method: 'PUT',
      headers: { ...basic(corp), 'content-type': 'application/json' },
      body: JSON.stringify({
        name: '@corp/tokens',
        versions: {
          '1.0.0': {
            name: '@corp/tokens',
            version: '1.0.0',
            dist: { tarball: `${corp.url}@corp/tokens/-/tokens-1.0.0.tgz` },
          },
        },
        'dist-tags': { latest: '1.0.0' },
        _attachments: {
          'tokens-1.0.0.tgz': { content_type: 'application/octet-stream', data: tarball, length: 20 },
        },
      }),
    });
    expect(published.status).toBe(201);

    const { username, password } = corp.credentials;
    const auth = { type: 'basic' as const, token: btoa(`${username}:${password}`) };
    const withAuth = await VerdaccioRegistry.start({
      storage: join(storage, 'with-auth'),
      port: 0,
      logLevel: 'fatal',
      uplinks: { corp: { url: corp.url, auth, scopes: ['@corp'] } },
    });
    const withoutAuth = await VerdaccioRegistry.start({
      storage: join(storage, 'without-auth'),
      port: 0,
      logLevel: 'fatal',
      uplinks: { corp: { url: corp.url, scopes: ['@corp'] } },
    });
    running.push(withAuth, withoutAuth);

    expect((await send(`${withAuth.url}@corp%2ftokens`)).status).toBe(200);
    // Verdaccio reports a refused uplink as a missing package; the twin above differs only in its auth.
    expect((await send(`${withoutAuth.url}@corp%2ftokens`)).status).toBe(404);
    await cleanPrivate();
  });

  it('frees its port when stopped', async () => {
    const registry = await start();
    await registry.stop();
    running.splice(0);

    await expect(send(`${registry.url}-/ping`)).rejects.toThrow(/ECONNREFUSED/);
  });

  it('reports a port that is already taken', async () => {
    const first = await start();
    const port = Number(new URL(first.url).port);

    await expect(VerdaccioRegistry.start({ storage, port, logLevel: 'fatal' })).rejects.toMatchObject({
      code: 'registry-failed',
      message: expect.stringMatching(new RegExp(`port ${port}`)),
    });
  });

  it("leaves the running registry's credentials alone when a second start on its storage loses the port", async () => {
    const first = await start();
    const port = Number(new URL(first.url).port);

    await VerdaccioRegistry.start({ storage, port, logLevel: 'fatal' }).catch(() => undefined);
    const whoami = await send(`${first.url}-/whoami`, { headers: basic(first) });

    expect(whoami.status).toBe(200);
  });
});
