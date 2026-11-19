import { timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { DryfitError } from '../core/errors.ts';
import {
  type ApiErrorBody,
  type ApiErrorCode,
  type Health,
  isOperationName,
  type OperationInput,
  type OperationName,
  type OperationOutputs,
  operations,
} from './api.ts';
import type { EventHub } from './event-hub.ts';
import { ValidationError } from './schema.ts';

const MAX_BODY_BYTES = 1_000_000;
/** Unsent event output a slow client may hold before its stream is dropped. */
const MAX_UNSENT_EVENT_BYTES = 4_000_000;

export interface ApiServerOptions {
  readonly token: string;
  readonly hub: EventHub;
  readonly health: () => Health;
  readonly service: {
    call<K extends OperationName>(name: K, input: OperationInput<K>): Promise<OperationOutputs[K]>;
  };
  /** Keeps idle event streams alive through proxies and lets clients notice a dead daemon. */
  readonly heartbeatMs?: number;
  /** Where unexpected errors are reported; the client only learns that one happened. */
  readonly onError: (error: unknown) => void;
}

/**
 * The daemon's HTTP API (ADR 0003, ADR 0012). Before anything else it refuses requests a browser could
 * make (an `Origin` header or a foreign `Host`), then everything but `/v1/health` without the bearer
 * token: an API that can publish and install runs arbitrary code, so no web page may reach it.
 */
export function createApiServer(options: ApiServerOptions): Server {
  const expected = Buffer.from(`Bearer ${options.token}`);
  const { onError } = options;

  const server = createServer((req, res) => {
    if (req.headers.origin !== undefined || !isLoopbackHost(req.headers.host, server)) {
      return sendError(res, 403, 'forbidden', 'dryfit refuses requests made by browsers');
    }
    const path = (req.url ?? '').split('?')[0] ?? '';
    // Health only says who is listening, so clients can check that before they send the token.
    if (req.method === 'GET' && path === '/v1/health') return sendJson(res, 200, options.health());

    const auth = Buffer.from(req.headers.authorization ?? '');
    if (auth.length !== expected.length || !timingSafeEqual(auth, expected)) {
      return sendError(res, 401, 'unauthorized', 'Missing or wrong dryfit token');
    }
    if (req.method === 'GET' && path === '/v1/events') return streamEvents(req, res, options);

    const operation = req.method === 'POST' ? /^\/v1\/([A-Za-z]+)$/.exec(path)?.[1] : undefined;
    if (operation === undefined || !isOperationName(operation)) {
      return sendError(res, 404, 'not-found', `No route for ${req.method} ${path}`);
    }
    handleOperation(req, res, operation, options, onError);
  });
  return server;
}

function handleOperation(
  req: IncomingMessage,
  res: ServerResponse,
  operation: OperationName,
  options: ApiServerOptions,
  onError: (error: unknown) => void,
): void {
  const chunks: Buffer[] = [];
  let size = 0;
  req.on('data', (chunk: Buffer) => {
    size += chunk.length;
    if (size <= MAX_BODY_BYTES) chunks.push(chunk);
  });
  req.on('end', async () => {
    if (size > MAX_BODY_BYTES)
      return sendError(res, 413, 'payload-too-large', 'The request body is too large');
    try {
      const text = Buffer.concat(chunks).toString('utf8');
      let body: unknown;
      try {
        body = text.length === 0 ? {} : JSON.parse(text);
      } catch {
        return sendError(res, 400, 'invalid-request', 'The request body is not valid JSON');
      }
      const input = operations[operation].parse(body) as OperationInput<typeof operation>;
      sendJson(res, 200, await options.service.call(operation, input));
    } catch (error) {
      if (error instanceof ValidationError) return sendError(res, 400, 'invalid-request', error.message);
      if (error instanceof DryfitError) {
        const status = error.code === 'daemon-stopping' ? 503 : 422;
        return sendError(res, status, error.code, error.message, error.details);
      }
      onError(error);
      sendError(res, 500, 'internal', 'dryfit hit an unexpected error; see the daemon log');
    }
  });
}

function streamEvents(req: IncomingMessage, res: ServerResponse, options: ApiServerOptions): void {
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
  });
  res.write(': dryfit events\n\n');

  // A client that stays connected but stops reading would otherwise make the daemon buffer every
  // event for it; past this much unsent output it is cut off and can reconnect with Last-Event-ID.
  const send = (text: string) => {
    if (res.writableLength > MAX_UNSENT_EVENT_BYTES) res.destroy();
    else res.write(text);
  };
  const lastId = Number(req.headers['last-event-id']);
  const unsubscribe = options.hub.subscribe(
    (event) => send(`id: ${event.id}\ndata: ${JSON.stringify(event)}\n\n`),
    Number.isInteger(lastId) && lastId >= 0 ? { after: lastId } : {},
  );
  const heartbeat = setInterval(() => send(': ping\n\n'), options.heartbeatMs ?? 15_000);
  heartbeat.unref();
  res.on('close', () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
}

function isLoopbackHost(host: string | undefined, server: Server): boolean {
  const { port } = server.address() as AddressInfo;
  return host === `127.0.0.1:${port}` || host === `localhost:${port}`;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
}

function sendError(
  res: ServerResponse,
  status: number,
  code: ApiErrorCode,
  message: string,
  details: Readonly<Record<string, unknown>> = {},
): void {
  const body: ApiErrorBody = { error: { code, message, details } };
  sendJson(res, status, body);
}
