import { describe, expect, it } from 'vitest';
import type { LibraryRecord } from '../core/model.ts';
import type { OperationInput, OperationName, OperationOutputs, StatusView } from '../daemon/api.ts';
import type { HubEvent, ServerEvent } from '../daemon/event-hub.ts';
import { type ApiClient, ApiError, type EventOptions } from './client.ts';
import { run } from './main.ts';

const ui: LibraryRecord = {
  name: '@acme/ui',
  root: '/Users/me/repos/ui-lib',
  publishDir: '/Users/me/repos/ui-lib/dist/ui',
};
const forms: LibraryRecord = {
  name: '@acme/forms',
  root: '/Users/me/repos/forms',
  publishDir: '/Users/me/repos/forms',
};

function status(overrides: Partial<StatusView> = {}): StatusView {
  return {
    daemon: {
      name: 'devlink',
      version: '0.1.0',
      apiVersion: 1,
      pid: 1,
      registryUrl: 'http://127.0.0.1:4874/',
      startedAt: '2026-11-18T09:00:00.000Z',
    },
    libraries: [ui],
    links: [],
    groups: [],
    warnings: [],
    jobs: { queued: [] },
    ...overrides,
  };
}

class FakeClient implements ApiClient {
  readonly calls: { name: OperationName; input: unknown }[] = [];
  readonly replies: Partial<{ [K in OperationName]: OperationOutputs[K] | ApiError }> = { status: status() };
  /** Replies that depend on the input; they win over `replies`. */
  readonly handlers: Partial<{ [K in OperationName]: (input: OperationInput<K>) => OperationOutputs[K] }> =
    {};
  /** Events to play to subscribers while a given operation runs. */
  readonly script: Partial<Record<OperationName, HubEvent[]>> = {};
  #listener: ((event: ServerEvent) => void) | undefined;

  async call<K extends OperationName>(name: K, input: OperationInput<K>): Promise<OperationOutputs[K]> {
    this.calls.push({ name, input });
    for (const [index, event] of (this.script[name] ?? []).entries()) {
      this.#listener?.({ ...event, id: index + 1, at: '' });
    }
    const handler = this.handlers[name] as ((input: OperationInput<K>) => OperationOutputs[K]) | undefined;
    if (handler) return handler(input);
    const reply = this.replies[name];
    if (reply instanceof ApiError) throw reply;
    if (reply === undefined) throw new Error(`no reply scripted for ${name}`);
    return reply as OperationOutputs[K];
  }

  async events(onEvent: (event: ServerEvent) => void, options: EventOptions) {
    this.#listener = onEvent;
    options.onOpen?.();
    await new Promise<void>((resolve) => options.signal.addEventListener('abort', () => resolve()));
  }
}

async function devlink(argv: string | string[], options: { client?: FakeClient; cwd?: string } = {}) {
  const client = options.client ?? new FakeClient();
  let stdout = '';
  let stderr = '';
  const code = await run(typeof argv === 'string' ? argv.split(' ').filter(Boolean) : argv, {
    cwd: options.cwd ?? '/Users/me/repos/ui-lib',
    env: { HOME: '/Users/me' },
    home: '/Users/me',
    stdout: (text) => (stdout += text),
    stderr: (text) => (stderr += text),
    connect: async () => client,
    color: false,
  });
  return { code, stdout, stderr, client };
}

describe('devlink CLI', () => {
  it('links consumers given relative to here, into the library this folder belongs to', async () => {
    const client = new FakeClient();
    client.replies.link = {
      link: { library: '@acme/ui', consumer: '/Users/me/repos/shop', status: 'pending' },
      guard: 'installed',
    };

    const { code, stdout } = await devlink('link ../../shop', { client, cwd: '/Users/me/repos/ui-lib/src' });

    expect(code).toBe(0);
    expect(client.calls.at(-1)).toEqual({
      name: 'link',
      input: { library: '@acme/ui', consumer: '/Users/me/repos/shop' },
    });
    expect(stdout).toContain('Linked @acme/ui into ~/repos/shop');
    expect(stdout).toContain('commit guard installed');
  });

  it('asks which library when it cannot tell', async () => {
    const client = new FakeClient();
    client.replies.status = status({ libraries: [ui, forms] });

    const { code, stderr } = await devlink('link /Users/me/repos/shop', { client, cwd: '/Users/me' });

    expect(code).toBe(1);
    expect(stderr).toContain('Which library? Pass --library: @acme/ui, @acme/forms');
  });

  it('passes --no-guard and an explicit --library through', async () => {
    const client = new FakeClient();
    client.replies.status = status({ libraries: [ui, forms] });
    client.replies.link = {
      link: { library: '@acme/forms', consumer: '/Users/me/repos/shop', status: 'pending' },
      guard: 'declined',
    };

    await devlink('link /Users/me/repos/shop --library @acme/forms --no-guard', { client, cwd: '/Users/me' });

    expect(client.calls.at(-1)?.input).toEqual({
      library: '@acme/forms',
      consumer: '/Users/me/repos/shop',
      guard: false,
    });
  });

  it('restores the current folder when no consumer is named', async () => {
    const client = new FakeClient();
    client.replies.restore = { ok: true };

    const { code, stdout } = await devlink('restore', { client, cwd: '/Users/me/repos/shop' });

    expect(code).toBe(0);
    expect(client.calls.at(-1)).toEqual({ name: 'restore', input: { consumer: '/Users/me/repos/shop' } });
    expect(stdout).toContain('Restored ~/repos/shop');
  });

  it('narrates a sync as it happens and fails when a consumer did not take the new version', async () => {
    const client = new FakeClient();
    const version = '1.4.1-dev.20261118143201';
    client.script.sync = [
      { type: 'build:started', library: '@acme/ui' },
      { type: 'build:succeeded', library: '@acme/ui' },
      { type: 'publish:succeeded', library: '@acme/ui', version },
      { type: 'install:started', library: '@acme/ui', consumer: '/Users/me/repos/shop', version },
      {
        type: 'install:failed',
        library: '@acme/ui',
        consumer: '/Users/me/repos/shop',
        version,
        output: 'npm ERR! ERESOLVE',
      },
    ];
    client.replies.sync = {
      version,
      installs: [{ consumer: '/Users/me/repos/shop', ok: false, version, output: 'npm ERR! ERESOLVE' }],
    };

    const { code, stdout } = await devlink('sync', { client });

    expect(code).toBe(1);
    expect(stdout).toContain('Building @acme/ui');
    expect(stdout).toContain(`Published @acme/ui@${version}`);
    expect(stdout).toContain('Install into ~/repos/shop failed');
    expect(stdout).toContain('npm ERR! ERESOLVE');
  });

  it('shows status: libraries, links with their versions, and coherence warnings', async () => {
    const client = new FakeClient();
    client.replies.status = status({
      libraries: [{ ...ui, watch: true, lastPublishedVersion: '1.4.1-dev.20261118143201' }],
      links: [
        {
          library: '@acme/ui',
          consumer: '/Users/me/repos/shop',
          status: 'installed',
          installedVersion: '1.4.1-dev.20261118143201',
          guard: true,
        },
      ],
      warnings: [
        {
          group: 'checkout',
          library: '@acme/ui',
          versions: [
            { consumer: '/Users/me/repos/shop', version: '1.4.1-dev.20261118143201' },
            { consumer: '/Users/me/repos/cart', version: '1.4.1-dev.20261118100000' },
          ],
        },
      ],
    });

    const { code, stdout } = await devlink('status', { client });

    expect(code).toBe(0);
    expect(stdout).toContain('@acme/ui');
    expect(stdout).toContain('watching');
    expect(stdout).toContain('~/repos/shop');
    expect(stdout).toContain('installed 1.4.1-dev.20261118143201');
    expect(stdout).toContain('checkout runs different versions of @acme/ui');
  });

  it('prints the raw result with --json, for scripts and agents', async () => {
    const { stdout } = await devlink('status --json');

    expect(JSON.parse(stdout)).toEqual(status());
  });

  it('splits --build into a command and arguments for registration', async () => {
    const client = new FakeClient();
    client.replies.register = {
      library: { ...ui, build: { command: 'npm', args: ['run', 'build:lib'], cwd: ui.root } },
      detected: 'given',
    };

    await devlink(['add', '--build', 'npm run build:lib', '--publish-dir', 'dist/ui'], { client });

    expect(client.calls.at(-1)).toEqual({
      name: 'register',
      input: {
        root: '/Users/me/repos/ui-lib',
        publishDir: '/Users/me/repos/ui-lib/dist/ui',
        build: { command: 'npm', args: ['run', 'build:lib'] },
      },
    });
  });

  it('explains a daemon error in one line with a hint, and exits 1', async () => {
    const client = new FakeClient();
    client.replies.restore = new ApiError(
      'manifest-drifted',
      '/Users/me/repos/shop/package.json has changes devlink did not make.',
    );

    const { code, stderr } = await devlink('restore', { client, cwd: '/Users/me/repos/shop' });

    expect(code).toBe(1);
    expect(stderr).toContain('devlink: /Users/me/repos/shop/package.json has changes devlink did not make.');
    expect(stderr).toContain('--force');
  });

  it('restores the linked project a subfolder belongs to', async () => {
    const client = new FakeClient();
    client.replies.status = status({
      links: [{ library: '@acme/ui', consumer: '/Users/me/repos/shop', status: 'installed' }],
    });
    client.replies.restore = { ok: true };

    const { code } = await devlink('restore', { client, cwd: '/Users/me/repos/shop/src/app' });

    expect(code).toBe(0);
    expect(client.calls.at(-1)).toEqual({ name: 'restore', input: { consumer: '/Users/me/repos/shop' } });
  });

  it('keeps restoring the other consumers when one fails, and exits 1', async () => {
    const client = new FakeClient();
    client.replies.status = status({
      links: [
        { library: '@acme/ui', consumer: '/Users/me/repos/shop', status: 'installed' },
        { library: '@acme/ui', consumer: '/Users/me/repos/admin', status: 'installed' },
      ],
    });
    client.handlers.restore = ({ consumer }) => {
      if (consumer.endsWith('shop'))
        throw new ApiError('manifest-drifted', 'shop has changes devlink did not make.');
      return { ok: true };
    };

    const { code, stdout, stderr } = await devlink('restore --all', { client });

    expect(code).toBe(1);
    expect(client.calls.filter((call) => call.name === 'restore')).toHaveLength(2);
    expect(stderr).toContain('shop has changes devlink did not make.');
    expect(stdout).toContain('Restored ~/repos/admin');
  });

  it('exits 1 with --json too when something failed, so scripts can tell', async () => {
    const version = '1.4.1-dev.20261118143201';
    const client = new FakeClient();
    client.replies.sync = {
      version,
      installs: [{ consumer: '/Users/me/repos/shop', ok: false, version, output: 'npm ERR!' }],
    };
    const failed = [{ consumer: '/Users/me/repos/shop', status: 'failed' as const, message: 'no' }];
    client.replies.linkGroup = failed;
    client.replies.restoreGroup = failed;

    const sync = await devlink('sync --json', { client });
    const link = await devlink('link --group checkout --json', { client });
    const restore = await devlink('restore --group checkout --json', { client });

    expect([sync.code, link.code, restore.code]).toEqual([1, 1, 1]);
    expect(JSON.parse(sync.stdout)).toMatchObject({ version });
  });

  it('reports an unexpected error in one line instead of crashing', async () => {
    const client = new FakeClient();
    client.replies.status = undefined as never;

    const { code, stderr } = await devlink('status', { client });

    expect(code).toBe(1);
    expect(stderr).toContain('devlink: unexpected error: no reply scripted for status');
  });

  it('refuses an empty --build', async () => {
    const { code, stderr, client } = await devlink(['add', '--build', '  ']);

    expect(code).toBe(2);
    expect(stderr).toContain('--build');
    expect(client.calls).toEqual([]);
  });

  it('shows usage for an unknown command, and exits 2', async () => {
    const { code, stderr } = await devlink('frobnicate');

    expect(code).toBe(2);
    expect(stderr).toContain('Unknown command: frobnicate');
    expect(stderr).toContain('Usage: devlink <command>');
  });
});
