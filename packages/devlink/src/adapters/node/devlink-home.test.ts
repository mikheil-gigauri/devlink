import { stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTempDir } from '../../testing/temp-dir.ts';
import { DEFAULT_CONFIG, DevlinkHome } from './devlink-home.ts';

describe('DevlinkHome', () => {
  let dir: string;
  let cleanup: () => Promise<void>;
  let home: DevlinkHome;

  beforeEach(async () => {
    ({ path: dir, cleanup } = await createTempDir());
    home = new DevlinkHome(join(dir, '.devlink'));
  });
  afterEach(() => cleanup());

  it('lives in ~/.devlink unless DEVLINK_HOME says otherwise', () => {
    expect(DevlinkHome.locate({}, '/Users/me').root).toBe('/Users/me/.devlink');
    expect(DevlinkHome.locate({ DEVLINK_HOME: '/tmp/dl' }, '/Users/me').root).toBe('/tmp/dl');
  });

  it('creates one token, readable by the owner only, and keeps it', async () => {
    const token = await home.ensureToken();

    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(await home.ensureToken()).toBe(token);
    expect((await stat(home.paths.token)).mode & 0o777).toBe(0o600);
    expect((await stat(home.root)).mode & 0o777).toBe(0o700);
  });

  it('replaces a damaged token file instead of handing out an empty token', async () => {
    await home.ensure();
    for (const damaged of ['', 'not a token\n']) {
      await writeFile(home.paths.token, damaged);

      const token = await home.ensureToken();

      expect(token).toMatch(/^[0-9a-f]{64}$/);
      expect(await home.readToken()).toBe(token);
      expect((await stat(home.paths.token)).mode & 0o777).toBe(0o600);
    }
  });

  it('agrees on one token when several processes create it at once', async () => {
    const racers = Array.from({ length: 8 }, () => new DevlinkHome(home.root));

    const tokens = await Promise.all(racers.map((racer) => racer.ensureToken()));

    expect(new Set(tokens).size).toBe(1);
    expect(tokens[0]).toMatch(/^[0-9a-f]{64}$/);
  });

  it('reads the defaults when there is no config, and fills gaps in a partial one', async () => {
    expect(await home.readConfig()).toEqual(DEFAULT_CONFIG);

    await home.writeConfig({ ...DEFAULT_CONFIG, roots: ['/repos'] });
    await writeFile(home.paths.config, JSON.stringify({ roots: ['/repos'] }));
    expect(await home.readConfig()).toEqual({ ...DEFAULT_CONFIG, roots: ['/repos'] });
  });

  it.each([
    ['roots that are not a list of paths', { roots: 'repos' }],
    ['a port out of range', { ports: { api: 70_000 } }],
    ['broken JSON', '{'],
  ])('refuses a config with %s, naming the file', async (_, config) => {
    await home.writeConfig(DEFAULT_CONFIG);
    await writeFile(home.paths.config, typeof config === 'string' ? config : JSON.stringify(config));

    await expect(home.readConfig()).rejects.toMatchObject({
      code: 'invalid-config',
      message: expect.stringContaining(home.paths.config),
    });
  });

  it('records the running daemon, and only that daemon may clear the record', async () => {
    const info = {
      pid: 4242,
      port: 4875,
      version: '1.0.0',
      registryUrl: 'http://127.0.0.1:4874/',
      startedAt: '2026-11-18T09:00:00.000Z',
    };
    await home.writeDaemonInfo(info);

    await home.removeDaemonInfo(1);
    expect(await home.readDaemonInfo()).toEqual(info);

    await home.removeDaemonInfo(4242);
    expect(await home.readDaemonInfo()).toBeUndefined();
  });
});
