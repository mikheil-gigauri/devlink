import { type ChildProcess, spawn } from 'node:child_process';
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DevlinkHome } from '../adapters/node/devlink-home.ts';
import type { Health } from '../daemon/api.ts';
import { createTempDir } from '../testing/temp-dir.ts';
import { LocalMachine } from './local.ts';
import { Output } from './output.ts';

/** The parts of LocalMachine that decide whether a process is devlink's daemon, without starting one. */
describe('LocalMachine, finding and stopping the daemon', () => {
  let cleanup: () => Promise<void>;
  let home: DevlinkHome;
  let machine: LocalMachine;
  let printed: string;
  let bystander: ChildProcess;
  let impostor: Server | undefined;

  const alive = (pid: number) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  };
  const freePort = async () => {
    const probe = createServer();
    await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve));
    const { port } = probe.address() as AddressInfo;
    await new Promise((resolve) => probe.close(resolve));
    return port;
  };
  /** Something on the port that answers health, recording what it was sent. */
  const answerHealth = async (health: Partial<Health>, seen: IncomingHttpHeaders[]) => {
    impostor = createServer((req, res) => {
      seen.push(req.headers);
      res.setHeader('content-type', 'application/json').end(JSON.stringify(health));
    });
    await new Promise<void>((resolve) => impostor?.listen(0, '127.0.0.1', resolve));
    return (impostor.address() as AddressInfo).port;
  };
  const describeDaemon = (pid: number, port: number) =>
    home.writeDaemonInfo({ pid, port, version: '0.0.0', registryUrl: '', startedAt: '' });

  beforeEach(async () => {
    let dir: string;
    ({ path: dir, cleanup } = await createTempDir());
    home = new DevlinkHome(join(dir, '.devlink'));
    printed = '';
    const out = new Output((text) => (printed += text), { color: false, home: dir });
    machine = new LocalMachine({
      home,
      version: '1.0.0',
      env: process.env,
      entry: '/nonexistent/devlink.mjs',
      out,
      err: out,
      signal: new AbortController().signal,
    });
    // A live process that is not devlink, standing in for a pid reused after a crash or reboot.
    bystander = spawn('sleep', ['30'], { stdio: 'ignore' });
  });
  afterEach(async () => {
    bystander.kill();
    impostor?.closeAllConnections();
    impostor?.close();
    impostor = undefined;
    await cleanup();
  });

  it('never signals a pid from daemon.json that does not answer as devlink', async () => {
    const pid = bystander.pid as number;
    await describeDaemon(pid, await freePort());

    const code = await machine.daemon('stop');

    expect(alive(pid)).toBe(true);
    expect(code).toBe(1);
    expect(printed).toContain(`pid ${pid}`);
  });

  it('does not trust, or send the token to, a process whose health names another pid', async () => {
    const pid = bystander.pid as number;
    const seen: IncomingHttpHeaders[] = [];
    await describeDaemon(pid, await answerHealth({ name: 'devlink', version: '1.0.0', pid: 1 }, seen));

    expect(await machine.daemon('status')).toBe(1);
    expect(await machine.daemon('stop')).toBe(1);

    expect(alive(pid)).toBe(true);
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((headers) => headers.authorization === undefined)).toBe(true);
  });
});
