import { request, type Server } from 'node:http';
import { type AddressInfo, connect } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DryfitError } from '../core/errors.ts';
import type { Health, OperationName } from './api.ts';
import { EventHub } from './event-hub.ts';
import { createApiServer } from './http-server.ts';

const TOKEN = 'a'.repeat(64);
const health: Health = {
  name: 'dryfit',
  version: '0.0.0-test',
  apiVersion: 1,
  pid: 1,
  registryUrl: 'http://127.0.0.1:4874/',
  startedAt: '2026-11-18T09:00:00.000Z',
};

interface Reply {
  status: number;
  body: string;
  json: () => unknown;
}

describe('API server', () => {
  let server: Server;
  let port: number;
  let hub: EventHub;
  const calls: { name: OperationName; input: unknown }[] = [];
  let respond: (name: OperationName, input: unknown) => Promise<unknown>;

  beforeEach(async () => {
    calls.length = 0;
    respond = async () => ({ ok: true });
    hub = new EventHub();
    server = createApiServer({
      token: TOKEN,
      hub,
      health: () => health,
      onError: () => {},
      service: {
        call: (name, input) => {
          calls.push({ name, input });
          return respond(name, input) as never;
        },
      },
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = (server.address() as AddressInfo).port;
  });
  afterEach(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });

  const send = (
    path: string,
    options: { method?: string; headers?: Record<string, string>; body?: string; auth?: boolean } = {},
  ) =>
    new Promise<Reply>((resolve, reject) => {
      const headers: Record<string, string> = {
        ...(options.auth !== false && { authorization: `Bearer ${TOKEN}` }),
        ...(options.body !== undefined && { 'content-type': 'application/json' }),
        ...options.headers,
      };
      const req = request(
        { host: '127.0.0.1', port, path, method: options.method ?? 'GET', headers },
        (res) => {
          let body = '';
          res.setEncoding('utf8').on('data', (chunk) => (body += chunk));
          res.on('end', () => resolve({ status: res.statusCode ?? 0, body, json: () => JSON.parse(body) }));
        },
      );
      req.on('error', reject);
      req.end(options.body);
    });
  const post = (operation: string, input: unknown, headers?: Record<string, string>) =>
    send(`/v1/${operation}`, { method: 'POST', body: JSON.stringify(input), ...(headers && { headers }) });

  it('answers health with the daemon’s identity, without the token', async () => {
    const reply = await send('/v1/health', { auth: false });

    expect(reply.status).toBe(200);
    expect(reply.json()).toEqual(health);
  });

  it.each([
    ['no token', { auth: false }],
    ['a wrong token', { headers: { authorization: `Bearer ${'b'.repeat(64)}` } }],
    ['a malformed header', { headers: { authorization: TOKEN } }],
  ])('refuses %s', async (_, options) => {
    const reply = await send('/v1/status', { method: 'POST', body: '{}', ...options });

    expect(reply.status).toBe(401);
    expect(reply.json()).toMatchObject({ error: { code: 'unauthorized' } });
  });

  it('refuses browsers even with the token, so no web page can trigger a publish', async () => {
    const crossOrigin = await post('sync', { library: '@acme/ui' }, { origin: 'https://evil.example' });
    const rebound = await post('sync', { library: '@acme/ui' }, { host: 'evil.example' });

    expect([crossOrigin.status, rebound.status]).toEqual([403, 403]);
    expect(calls).toEqual([]);
  });

  it('validates the body and hands the typed input to the service', async () => {
    respond = async () => ({ ok: true });

    const reply = await post('link', { library: '@acme/ui', consumer: '/repos/shop' });

    expect(reply.status).toBe(200);
    expect(reply.json()).toEqual({ ok: true });
    expect(calls).toEqual([{ name: 'link', input: { library: '@acme/ui', consumer: '/repos/shop' } }]);
  });

  it('explains an invalid body without calling the service', async () => {
    const reply = await post('link', { library: '@acme/ui', consumer: 'shop' });

    expect(reply.status).toBe(400);
    expect(reply.json()).toEqual({
      error: { code: 'invalid-request', message: 'consumer: expected an absolute path', details: {} },
    });
    expect(calls).toEqual([]);
  });

  it('rejects a body that is not JSON, or too large', async () => {
    const garbled = await send('/v1/status', { method: 'POST', body: '{nope' });
    const huge = await send('/v1/status', {
      method: 'POST',
      body: JSON.stringify({ x: 'y'.repeat(1_100_000) }),
    });

    expect([garbled.status, huge.status]).toEqual([400, 413]);
  });

  it('passes an expected failure through with its code and details', async () => {
    respond = async () => {
      throw new DryfitError('library-not-found', 'No library named @acme/x is registered', {
        library: '@acme/x',
      });
    };

    const reply = await post('sync', { library: '@acme/x' });

    expect(reply.status).toBe(422);
    expect(reply.json()).toEqual({
      error: {
        code: 'library-not-found',
        message: 'No library named @acme/x is registered',
        details: { library: '@acme/x' },
      },
    });
  });

  it('hides the internals of an unexpected failure', async () => {
    respond = async () => {
      throw new TypeError('cannot read properties of undefined (reading secret)');
    };

    const reply = await post('status', {});

    expect(reply.status).toBe(500);
    expect(reply.json()).toEqual({
      error: {
        code: 'internal',
        message: 'dryfit hit an unexpected error; see the daemon log',
        details: {},
      },
    });
  });

  it('reports unknown routes and operations', async () => {
    expect((await post('format-disk', {})).status).toBe(404);
    expect((await send('/v1/status')).status).toBe(404);
    expect((await send('/elsewhere')).status).toBe(404);
  });

  it('drops an event stream whose client stopped reading, instead of buffering for it forever', async () => {
    const socket = connect(port, '127.0.0.1');
    const closed = new Promise<void>((resolve) => socket.once('close', () => resolve()));
    socket.on('error', () => {});
    socket.write(
      `GET /v1/events HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nAuthorization: Bearer ${TOKEN}\r\n\r\n`,
    );
    socket.pause(); // connected, but never reads
    await new Promise((resolve) => setTimeout(resolve, 50));

    const output = 'x'.repeat(100_000);
    for (let n = 0; n < 200; n += 1) hub.emit({ type: 'build:failed', library: '@acme/ui', output });
    socket.resume(); // drain what was sent: the stream then ends only if the server dropped it

    await closed;
  });

  it('streams events, and replays what a reconnecting client missed', async () => {
    hub.emit({ type: 'build:started', library: 'a' });
    hub.emit({ type: 'build:started', library: 'b' });

    const lines = await new Promise<string[]>((resolve, reject) => {
      const req = request(
        {
          host: '127.0.0.1',
          port,
          path: '/v1/events',
          headers: { authorization: `Bearer ${TOKEN}`, 'last-event-id': '1' },
        },
        (res) => {
          expect(res.headers['content-type']).toBe('text/event-stream');
          let text = '';
          res.setEncoding('utf8').on('data', (chunk: string) => {
            text += chunk;
            if (text.includes('"library":"c"')) {
              req.destroy();
              resolve(text.split('\n').filter((line) => line.startsWith('id:') || line.startsWith('data:')));
            }
          });
          setTimeout(() => hub.emit({ type: 'build:started', library: 'c' }), 20);
        },
      );
      req.on('error', reject);
      req.end();
    });

    expect(lines.map((line) => line.replace(/"at":"[^"]+",/, ''))).toEqual([
      'id: 2',
      'data: {"id":2,"type":"build:started","library":"b"}',
      'id: 3',
      'data: {"id":3,"type":"build:started","library":"c"}',
    ]);
  });
});
