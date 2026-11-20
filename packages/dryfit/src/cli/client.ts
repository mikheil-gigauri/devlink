import { request } from 'node:http';
import type {
  ApiErrorBody,
  ApiErrorCode,
  Health,
  OperationInput,
  OperationName,
  OperationOutputs,
} from '../daemon/api.ts';
import type { ServerEvent } from '../daemon/event-hub.ts';

/** A failure the daemon reported, or `daemon-unavailable` when it could not be reached. */
export class ApiError extends Error {
  override readonly name = 'ApiError';
  readonly code: ApiErrorCode | 'daemon-unavailable';
  readonly details: Readonly<Record<string, unknown>>;

  constructor(code: ApiError['code'], message: string, details: Readonly<Record<string, unknown>> = {}) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

/** What commands need from the daemon. The CLI's tests substitute a fake. */
export interface ApiClient {
  call<K extends OperationName>(name: K, input: OperationInput<K>): Promise<OperationOutputs[K]>;
  /** Follows events until `signal` aborts. `onOpen` runs once the stream is live, so nothing is missed. */
  events(onEvent: (event: ServerEvent) => void, options: EventOptions): Promise<void>;
}

export interface EventOptions {
  readonly signal: AbortSignal;
  readonly onOpen?: () => void;
}

/** Talks to dryfitd over its HTTP API (ADR 0012). */
export class DaemonClient implements ApiClient {
  readonly baseUrl: string;
  readonly #token: string;

  constructor(baseUrl: string, token: string) {
    this.baseUrl = baseUrl;
    this.#token = token;
  }

  /**
   * Who is listening. Sent without the token, so a client can check it is talking to dryfit before
   * trusting the port; a daemon that does not answer within `timeoutMs` counts as unavailable.
   */
  health(options: { readonly timeoutMs?: number } = {}): Promise<Health> {
    return this.#request('GET', 'v1/health', undefined, {
      token: false,
      signal: AbortSignal.timeout(options.timeoutMs ?? 2_000),
    }) as Promise<Health>;
  }

  call<K extends OperationName>(name: K, input: OperationInput<K>): Promise<OperationOutputs[K]> {
    return this.#request('POST', `v1/${name}`, input) as Promise<OperationOutputs[K]>;
  }

  /** Delivers events as they happen until `signal` aborts or the daemon goes away. */
  async events(onEvent: (event: ServerEvent) => void, options: EventOptions): Promise<void> {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}v1/events`, {
        headers: this.#headers(),
        signal: options.signal,
      });
    } catch (error) {
      if (options.signal.aborted) return;
      throw unavailable(error);
    }
    if (!response.ok || !response.body) throw await toError(response);
    options.onOpen?.();

    const decoder = new TextDecoder();
    let buffer = '';
    try {
      for await (const chunk of response.body) {
        buffer += decoder.decode(chunk, { stream: true });
        let boundary = buffer.indexOf('\n\n');
        while (boundary !== -1) {
          const block = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          const data = block
            .split('\n')
            .filter((line) => line.startsWith('data: '))
            .map((line) => line.slice(6))
            .join('\n');
          if (data) onEvent(JSON.parse(data) as ServerEvent);
          if (options.signal.aborted) return;
          boundary = buffer.indexOf('\n\n');
        }
      }
    } catch (error) {
      if (!options.signal.aborted) throw unavailable(error);
    }
  }

  /**
   * One request over node:http rather than fetch: the daemon answers an operation only when its job
   * is done, which can take longer than fetch's fixed five minutes to receive the headers.
   */
  async #request(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
    options: { readonly token?: boolean; readonly signal?: AbortSignal } = {},
  ): Promise<unknown> {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    let reply: { readonly status: number; readonly text: string };
    try {
      reply = await new Promise((resolve, reject) => {
        const req = request(
          new URL(path, this.baseUrl),
          {
            method,
            headers: {
              ...(options.token !== false && this.#headers()),
              ...(payload !== undefined && {
                'content-type': 'application/json',
                'content-length': Buffer.byteLength(payload),
              }),
            },
            ...(options.signal && { signal: options.signal }),
          },
          (res) => {
            const chunks: Buffer[] = [];
            res.on('data', (chunk: Buffer) => chunks.push(chunk));
            res.on('end', () =>
              resolve({ status: res.statusCode ?? 0, text: Buffer.concat(chunks).toString('utf8') }),
            );
            res.on('error', reject);
          },
        );
        req.on('error', reject);
        req.end(payload);
      });
    } catch (error) {
      // No answer, a timeout, or the connection dropped.
      throw unavailable(error);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(reply.text);
    } catch {
      // Something else on the port.
      throw unavailable(new Error(`it answered HTTP ${reply.status} with something other than JSON`));
    }
    if (reply.status < 200 || reply.status >= 300) throw toApiError(parsed, reply.status);
    return parsed;
  }

  #headers(): Record<string, string> {
    return { authorization: `Bearer ${this.#token}` };
  }
}

async function toError(response: Response): Promise<ApiError> {
  return toApiError(await response.json().catch(() => undefined), response.status);
}

function toApiError(body: unknown, status: number): ApiError {
  const error = (body as Partial<ApiErrorBody> | undefined)?.error;
  return error
    ? new ApiError(error.code, error.message, error.details)
    : new ApiError('internal', `The daemon answered HTTP ${status}`);
}

function unavailable(error: unknown): ApiError {
  const reason = error instanceof Error ? error.message : String(error);
  return new ApiError('daemon-unavailable', `Could not reach the dryfit daemon (${reason})`);
}
