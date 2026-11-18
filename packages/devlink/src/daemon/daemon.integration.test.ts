import { mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DevlinkHome } from '../adapters/node/devlink-home.ts';
import { createTempDir } from '../testing/temp-dir.ts';
import { type RunningDaemon, startDaemon } from './daemon.ts';

describe('startDaemon', () => {
  let dir: string;
  let cleanup: () => Promise<void>;
  let home: DevlinkHome;
  let env: NodeJS.ProcessEnv;
  const running: RunningDaemon[] = [];

  beforeEach(async () => {
    ({ path: dir, cleanup } = await createTempDir());
    home = new DevlinkHome(join(dir, '.devlink'));
    await home.writeConfig({ roots: [join(dir, 'repos')], ports: { api: 0, registry: 0 } });
    await mkdir(join(dir, 'user'), { recursive: true });
    await writeFile(join(dir, 'user', '.npmrc'), '@corp:registry=https://npm.corp.example/\n');
    env = { ...process.env, HOME: join(dir, 'user') };
  });
  afterEach(async () => {
    await Promise.all(running.splice(0).map((daemon) => daemon.stop()));
    await cleanup();
  });

  const freePort = async () => {
    const probe = createServer();
    await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve));
    const { port } = probe.address() as { port: number };
    await new Promise((resolve) => probe.close(resolve));
    return port;
  };
  const refused = (port: number) => expect(fetch(`http://127.0.0.1:${port}/`)).rejects.toThrow();

  const start = async () => {
    const daemon = await startDaemon({ home, version: '9.9.9-test', env, log: () => {} });
    running.push(daemon);
    return daemon;
  };
  const call = async (daemon: RunningDaemon, path: string, body?: unknown) => {
    const token = await home.readToken();
    const response = await fetch(`${daemon.url}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      ...(body !== undefined && { body: JSON.stringify(body) }),
    });
    return { status: response.status, body: (await response.json()) as Record<string, unknown> };
  };

  it('serves the API with its registry, and tells clients where to find it', async () => {
    const daemon = await start();

    const health = await call(daemon, 'v1/health');
    const info = await home.readDaemonInfo();

    expect(health.body).toMatchObject({
      name: 'devlink',
      version: '9.9.9-test',
      registryUrl: daemon.registryUrl,
    });
    expect(info).toMatchObject({
      pid: process.pid,
      port: Number(new URL(daemon.url).port),
      version: '9.9.9-test',
    });
    expect((await fetch(`${daemon.registryUrl}-/ping`)).status).toBe(200);
  });

  it('answers status, and refuses callers without the token', async () => {
    const daemon = await start();

    expect((await call(daemon, 'v1/status', {})).body).toMatchObject({
      libraries: [],
      links: [],
      groups: [],
    });
    expect((await fetch(`${daemon.url}v1/status`, { method: 'POST', body: '{}' })).status).toBe(401);
  });

  it('shuts down when asked, freeing its ports and clearing its record', async () => {
    const daemon = await start();

    expect((await call(daemon, 'v1/shutdown', {})).body).toEqual({ ok: true });
    await daemon.stopped;

    expect(await home.readDaemonInfo()).toBeUndefined();
    await expect(fetch(`${daemon.url}v1/health`)).rejects.toThrow();
    await expect(fetch(`${daemon.registryUrl}-/ping`)).rejects.toThrow();
  });

  it('names the port when the API port is taken, and leaves nothing running', async () => {
    const blocker = createServer();
    await new Promise<void>((resolve) => blocker.listen(0, '127.0.0.1', resolve));
    const port = (blocker.address() as { port: number }).port;
    const registry = await freePort();
    await home.writeConfig({ roots: [], ports: { api: port, registry } });

    try {
      await expect(startDaemon({ home, version: '9.9.9-test', env, log: () => {} })).rejects.toMatchObject({
        code: 'daemon-failed',
        message: expect.stringContaining(`port ${port}`),
      });
      expect(await home.readDaemonInfo()).toBeUndefined();
      await refused(registry);
    } finally {
      await new Promise((resolve) => blocker.close(resolve));
    }
  });

  it('releases both ports when a step after listening fails', async () => {
    const [api, registry] = [await freePort(), await freePort()];
    await home.writeConfig({ roots: [], ports: { api, registry } });
    await mkdir(home.paths.daemon, { recursive: true }); // daemon.json cannot be written

    await expect(startDaemon({ home, version: '9.9.9-test', env, log: () => {} })).rejects.toThrow();

    await refused(api);
    await refused(registry);
  });
});
