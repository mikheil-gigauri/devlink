import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DryfitError } from '../core/errors.ts';
import type { Health } from '../daemon/api.ts';
import { EventHub, type ServerEvent } from '../daemon/event-hub.ts';
import { createApiServer } from '../daemon/http-server.ts';
import { ApiError, DaemonClient } from './client.ts';

const TOKEN = 'c'.repeat(64);
const health: Health = {
  name: 'dryfit',
  version: '1.2.3',
  apiVersion: 1,
  pid: 7,
  registryUrl: 'http://127.0.0.1:4874/',
  startedAt: '2026-11-18T09:00:00.000Z',
};

describe('DaemonClient', () => {
  let server: Server;
  let hub: EventHub;
  let client: DaemonClient;

  beforeEach(async () => {
    hub = new EventHub();
    server = createApiServer({
      token: TOKEN,
      hub,
      health: () => health,
      onError: () => {},
      service: {
        call: async (name, input) => {
          if (name === 'sync')
            throw new DryfitError('build-failed', 'Building @acme/ui failed', { output: 'TS2304' });
          return { name, input } as never;
        },
      },
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    client = new DaemonClient(`http://127.0.0.1:${(server.address() as AddressInfo).port}/`, TOKEN);
  });
  afterEach(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });

  it('reads health and calls operations', async () => {
    expect(await client.health()).toEqual(health);
    expect(await client.call('link', { library: '@acme/ui', consumer: '/repos/shop' })).toEqual({
      name: 'link',
      input: { library: '@acme/ui', consumer: '/repos/shop' },
    });
  });

  it('turns an error reply into an ApiError carrying the code and details', async () => {
    const failure = client.call('sync', { library: '@acme/ui' });

    await expect(failure).rejects.toBeInstanceOf(ApiError);
    await expect(failure).rejects.toMatchObject({
      code: 'build-failed',
      message: 'Building @acme/ui failed',
      details: { output: 'TS2304' },
    });
  });

  it('reads health without the token, so it can check who it is talking to before sending it', async () => {
    const stranger = new DaemonClient(client.baseUrl, 'd'.repeat(64));

    expect(await stranger.health()).toEqual(health);
    await expect(stranger.call('status', {})).rejects.toMatchObject({ code: 'unauthorized' });
  });

  it('gives up on a daemon that accepts the connection but never answers', async () => {
    const silent = createServer(() => {});
    await new Promise<void>((resolve) => silent.listen(0, '127.0.0.1', resolve));
    const port = (silent.address() as AddressInfo).port;

    const reply = new DaemonClient(`http://127.0.0.1:${port}/`, TOKEN).health({ timeoutMs: 50 });

    await expect(reply).rejects.toMatchObject({ code: 'daemon-unavailable' });
    silent.closeAllConnections();
    silent.close();
  });

  it('reports something other than dryfit on the port as unavailable, not as a crash', async () => {
    const stranger = createServer((_req, res) => res.end('<html>hello</html>'));
    await new Promise<void>((resolve) => stranger.listen(0, '127.0.0.1', resolve));
    const port = (stranger.address() as AddressInfo).port;

    const reply = new DaemonClient(`http://127.0.0.1:${port}/`, TOKEN).health();

    await expect(reply).rejects.toMatchObject({ code: 'daemon-unavailable' });
    stranger.close();
  });

  it('follows the event stream until told to stop', async () => {
    const received: ServerEvent[] = [];
    const controller = new AbortController();

    const following = client.events(
      (event) => {
        received.push(event);
        if (received.length === 2) controller.abort();
      },
      {
        signal: controller.signal,
        onOpen: () => {
          hub.emit({ type: 'build:started', library: '@acme/ui' });
          hub.emit({ type: 'build:succeeded', library: '@acme/ui' });
        },
      },
    );
    await following;

    expect(received.map((event) => event.type)).toEqual(['build:started', 'build:succeeded']);
  });
});
