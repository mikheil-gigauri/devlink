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
      name: 'dryfit',
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

async function dryfit(
  argv: string | string[],
  options: {
    client?: FakeClient;
    cwd?: string;
    entry?: string;
    env?: NodeJS.ProcessEnv;
    agentCalls?: { action: string; skillsDir: string }[];
  } = {},
) {
  const client = options.client ?? new FakeClient();
  let stdout = '';
  let stderr = '';
  const code = await run(typeof argv === 'string' ? argv.split(' ').filter(Boolean) : argv, {
    cwd: options.cwd ?? '/Users/me/repos/ui-lib',
    env: options.env ?? { HOME: '/Users/me' },
    home: '/Users/me',
    stdout: (text) => (stdout += text),
    stderr: (text) => (stderr += text),
    connect: async () => client,
    local: {
      init: async (roots) => ({ home: '/Users/me/.dryfit', roots }),
      daemon: async () => 0,
      doctor: async () => 0,
      skill: async () => '---\nname: dryfit\n---\n\n# dryfit\n',
      agent: async (action, skillsDir) => {
        options.agentCalls?.push({ action, skillsDir });
        return { path: `${skillsDir}/dryfit/SKILL.md`, changed: true };
      },
    },
    color: false,
    ...(options.entry !== undefined && { entry: options.entry }),
  });
  return { code, stdout, stderr, client };
}

describe('dryfit CLI', () => {
  it('sets up with the parent folder as the place projects live, and says what to do next', async () => {
    const { code, stdout } = await dryfit('init');

    expect(code).toBe(0);
    expect(stdout).toContain('roots     ~/repos');
    expect(stdout).toContain('Next: run dryfit add in a library');
    expect(stdout).not.toContain('npx');
  });

  it('tells someone trying it through npx how to type `dryfit` directly', async () => {
    const entry = '/Users/me/.npm/_npx/0c8a3f/node_modules/@dryfit/cli/dist/dryfit.mjs';

    const { stdout } = await dryfit('init', { entry });

    expect(stdout).toContain('Next: run npx @dryfit/cli add in a library');
    expect(stdout).toContain('npm install --global @dryfit/cli');
  });

  it('hides apps given relative to here, lists the hidden ones, and shows them again', async () => {
    const client = new FakeClient();
    let hidden: string[] = [];
    client.handlers.hideApps = ({ consumers, hidden: hide }) => {
      hidden = hide ? [...hidden, ...consumers] : hidden.filter((app) => !consumers.includes(app));
      return { hiddenApps: hidden };
    };
    client.handlers.hiddenApps = () => ({ hiddenApps: hidden });

    expect((await dryfit('hide ../old-shop', { client })).code).toBe(0);
    expect(client.calls.at(-1)).toEqual({
      name: 'hideApps',
      input: { consumers: ['/Users/me/repos/old-shop'], hidden: true },
    });
    expect((await dryfit('hide', { client })).stdout).toContain('~/repos/old-shop');
    expect((await dryfit('unhide ../old-shop', { client })).code).toBe(0);
    expect((await dryfit('hide', { client })).stdout).toContain('No hidden apps.');
  });

  it('will not hide a linked app, and says to restore it first', async () => {
    const client = new FakeClient();
    client.replies.hideApps = new ApiError(
      'consumer-linked',
      '/Users/me/repos/shop is still linked; restore it first',
      {
        consumers: ['/Users/me/repos/shop'],
      },
    );

    const { code, stderr } = await dryfit('hide ../shop', { client });

    expect(code).toBe(1);
    expect(stderr).toContain('restore it first');
    expect(stderr).toContain('Run `dryfit restore` in that app first');
  });

  it('asks which apps to show again', async () => {
    expect((await dryfit('unhide')).code).toBe(2);
  });

  it('links consumers given relative to here, into the library this folder belongs to', async () => {
    const client = new FakeClient();
    const link = { library: '@acme/ui', consumer: '/Users/me/repos/shop', status: 'pending' as const };
    client.replies.link = { link, links: [link], guard: 'installed' };

    const { code, stdout } = await dryfit('link ../../shop', { client, cwd: '/Users/me/repos/ui-lib/src' });

    expect(code).toBe(0);
    expect(client.calls.at(-1)).toEqual({
      name: 'link',
      input: { library: '@acme/ui', consumer: '/Users/me/repos/shop' },
    });
    expect(stdout).toContain('Linked @acme/ui into ~/repos/shop');
    expect(stdout).toContain('commit guard installed');
  });

  it('exits 1 when the first install into a linked consumer fails, and says why', async () => {
    const client = new FakeClient();
    const link = {
      library: '@acme/ui',
      consumer: '/Users/me/repos/shop',
      status: 'failed' as const,
      message: 'npm error code ERESOLVE\nnpm error ERESOLVE unable to resolve dependency tree',
    };
    const failed = { link, links: [link], guard: 'installed' as const };
    client.replies.link = failed;

    const json = await dryfit('link /Users/me/repos/shop --json', { client, cwd: '/Users/me/repos/ui-lib' });
    const human = await dryfit('link /Users/me/repos/shop', { client, cwd: '/Users/me/repos/ui-lib' });

    expect(json.code).toBe(1);
    expect(JSON.parse(json.stdout)).toEqual([failed]);
    expect(human.code).toBe(1);
    expect(human.stdout).toContain('Install into ~/repos/shop failed');
    expect(human.stdout).toContain('ERESOLVE unable to resolve dependency tree');
    expect(human.stdout).not.toContain('Next:');
  });

  it('names each library whose install failed when several were linked, showing npm’s reason once', async () => {
    const client = new FakeClient();
    client.replies.status = status({ libraries: [ui, forms] });
    const message = 'npm error code ERESOLVE';
    const failedLink = (library: string) => ({
      library,
      consumer: '/Users/me/repos/shop',
      status: 'failed' as const,
      message,
    });
    const first = failedLink('@acme/forms');
    client.replies.link = { link: first, links: [first, failedLink('@acme/ui')], guard: 'installed' };

    const { code, stdout } = await dryfit(
      'link /Users/me/repos/shop --library @acme/forms --library @acme/ui',
      {
        client,
        cwd: '/Users/me',
      },
    );

    expect(code).toBe(1);
    expect(stdout).toContain('Install of @acme/forms into ~/repos/shop failed');
    expect(stdout).toContain('Install of @acme/ui into ~/repos/shop failed');
    expect(stdout.split(message).length - 1).toBe(1);
  });

  it('asks which library when it cannot tell', async () => {
    const client = new FakeClient();
    client.replies.status = status({ libraries: [ui, forms] });

    const { code, stderr } = await dryfit('link /Users/me/repos/shop', { client, cwd: '/Users/me' });

    expect(code).toBe(1);
    expect(stderr).toContain('Which library? Pass --library: @acme/ui, @acme/forms');
  });

  it('passes --no-guard and an explicit --library through', async () => {
    const client = new FakeClient();
    client.replies.status = status({ libraries: [ui, forms] });
    const link = { library: '@acme/forms', consumer: '/Users/me/repos/shop', status: 'pending' as const };
    client.replies.link = { link, links: [link], guard: 'declined' };

    await dryfit('link /Users/me/repos/shop --library @acme/forms --no-guard', { client, cwd: '/Users/me' });

    expect(client.calls.at(-1)?.input).toEqual({
      library: '@acme/forms',
      consumer: '/Users/me/repos/shop',
      guard: false,
    });
  });

  it('links several libraries into a consumer in one call, so they install together', async () => {
    const client = new FakeClient();
    client.replies.status = status({ libraries: [ui, forms] });
    const formsLink = {
      library: '@acme/forms',
      consumer: '/Users/me/repos/shop',
      status: 'installed' as const,
      installedVersion: '2.0.1-dev.20261120101010',
    };
    const links = [
      formsLink,
      {
        library: '@acme/ui',
        consumer: '/Users/me/repos/shop',
        status: 'installed' as const,
        installedVersion: '1.4.1-dev.20261120101011',
      },
    ];
    client.replies.link = { link: formsLink, links, guard: 'installed' };

    const { code, stdout } = await dryfit(
      'link /Users/me/repos/shop --library @acme/forms --library @acme/ui',
      {
        client,
        cwd: '/Users/me',
      },
    );

    expect(code).toBe(0);
    expect(client.calls.at(-1)?.input).toEqual({
      library: '@acme/forms',
      libraries: ['@acme/ui'],
      consumer: '/Users/me/repos/shop',
    });
    expect(stdout).toContain('Linked @acme/forms, @acme/ui into ~/repos/shop');
    expect(stdout).toContain('@acme/ui running 1.4.1-dev.20261120101011');
  });

  it('names every library a restore took back with the one asked for', async () => {
    const client = new FakeClient();
    client.replies.restore = { ok: true, libraries: ['@acme/forms', '@acme/ui'] };

    const { stdout } = await dryfit('restore /Users/me/repos/shop --library @acme/ui', { client });

    expect(stdout).toContain('Restored @acme/forms, @acme/ui in ~/repos/shop');
  });

  it('restores the current folder when no consumer is named', async () => {
    const client = new FakeClient();
    client.replies.restore = { ok: true };

    const { code, stdout } = await dryfit('restore', { client, cwd: '/Users/me/repos/shop' });

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
      published: [{ library: '@acme/ui', version }],
      installs: [
        {
          consumer: '/Users/me/repos/shop',
          ok: false,
          version,
          libraries: [{ library: '@acme/ui', version }],
          output: 'npm ERR! ERESOLVE',
        },
      ],
    };

    const { code, stdout } = await dryfit('sync', { client });

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

    const { code, stdout } = await dryfit('status', { client });

    expect(code).toBe(0);
    expect(stdout).toContain('@acme/ui');
    expect(stdout).toContain('watching');
    expect(stdout).toContain('~/repos/shop');
    expect(stdout).toContain('installed 1.4.1-dev.20261118143201');
    expect(stdout).toContain('checkout runs different versions of @acme/ui');
  });

  it("shows why a link's last install failed", async () => {
    const client = new FakeClient();
    client.replies.status = status({
      links: [
        {
          library: '@acme/ui',
          consumer: '/Users/me/repos/shop',
          status: 'failed',
          message: 'npm error ERESOLVE unable to resolve dependency tree',
        },
      ],
    });

    const { stdout } = await dryfit('status', { client });

    expect(stdout).toContain('last install failed');
    expect(stdout).toContain('npm error ERESOLVE unable to resolve dependency tree');
  });

  it('prints the raw result with --json, for scripts and agents', async () => {
    const { stdout } = await dryfit('status --json');

    expect(JSON.parse(stdout)).toEqual(status());
  });

  it.each(['tsc -p a.json && node copy.js', 'NODE_ENV=production vite build', 'tsc | tee log'])(
    'refuses shell syntax in --build, which runs without a shell: %s',
    async (build) => {
      const client = new FakeClient();
      const { code, stderr } = await dryfit(['add', '--build', build], { client });

      expect(code).toBe(2);
      expect(stderr).toContain('npm run <script>');
      expect(client.calls.some((call) => call.name === 'register')).toBe(false);
    },
  );

  it('refuses --group together with apps, and with --library or --all on restore', async () => {
    for (const argv of [
      'link --group checkout /Users/me/repos/extra',
      'restore --group checkout --library @acme/forms',
      'restore --group checkout --all',
    ]) {
      const client = new FakeClient();
      const { code } = await dryfit(argv, { client, cwd: '/Users/me/repos/ui-lib' });
      expect(code, argv).toBe(2);
      expect(
        client.calls.some((call) => call.name === 'linkGroup' || call.name === 'restoreGroup'),
        argv,
      ).toBe(false);
    }
  });

  it('passes --no-guard to a group link', async () => {
    const client = new FakeClient();
    client.replies.linkGroup = [];

    await dryfit('link --group checkout --no-guard', { client, cwd: '/Users/me/repos/ui-lib' });

    expect(client.calls.find((call) => call.name === 'linkGroup')?.input).toEqual({
      group: 'checkout',
      library: '@acme/ui',
      guard: false,
    });
  });

  it('prints only JSON for restore --all --json when nothing is linked', async () => {
    const { code, stdout } = await dryfit('restore --all --json');

    expect(code).toBe(0);
    expect(JSON.parse(stdout)).toEqual([]);
  });

  it('splits --build into a command and arguments for registration', async () => {
    const client = new FakeClient();
    client.replies.register = {
      library: { ...ui, build: { command: 'npm', args: ['run', 'build:lib'], cwd: ui.root } },
      detected: 'given',
    };

    await dryfit(['add', '--build', 'npm run build:lib', '--publish-dir', 'dist/ui'], { client });

    expect(client.calls.at(-1)).toEqual({
      name: 'register',
      input: {
        root: '/Users/me/repos/ui-lib',
        publishDir: '/Users/me/repos/ui-lib/dist/ui',
        build: { command: 'npm', args: ['run', 'build:lib'] },
      },
    });
  });

  describe('add with one flag keeps the other setting', () => {
    const inspected = {
      name: '@acme/ui',
      version: '1.4.0',
      root: '/Users/me/repos/ui-lib',
      detected: 'nx' as const,
      publishDir: '/Users/me/dist/libs/ui',
      build: { command: '/Users/me/node_modules/.bin/nx', args: ['build', 'ui'] },
      registered: false,
    };

    it('keeps the detected build when only --publish-dir is given', async () => {
      const client = new FakeClient();
      client.replies.inspect = inspected;
      client.replies.register = { library: ui, detected: 'given' };

      await dryfit(['add', '--publish-dir', 'out'], { client });

      expect(client.calls.at(-1)).toEqual({
        name: 'register',
        input: { root: inspected.root, publishDir: `${inspected.root}/out`, build: inspected.build },
      });
    });

    it('keeps the detected publish folder when only --build is given', async () => {
      const client = new FakeClient();
      client.replies.inspect = inspected;
      client.replies.register = { library: ui, detected: 'given' };

      await dryfit(['add', '--build', 'npm run build:lib'], { client });

      expect(client.calls.at(-1)).toEqual({
        name: 'register',
        input: {
          root: inspected.root,
          publishDir: inspected.publishDir,
          build: { command: 'npm', args: ['run', 'build:lib'] },
        },
      });
    });

    it('leaves the build empty when the library has none', async () => {
      const client = new FakeClient();
      const { build: _, ...withoutBuild } = inspected;
      client.replies.inspect = { ...withoutBuild, detected: 'none' };
      client.replies.register = { library: ui, detected: 'given' };

      await dryfit(['add', '--publish-dir', 'out'], { client });

      expect(client.calls.at(-1)).toEqual({
        name: 'register',
        input: { root: inspected.root, publishDir: `${inspected.root}/out` },
      });
    });
  });

  it('explains a daemon error in one line with a hint, and exits 1', async () => {
    const client = new FakeClient();
    client.replies.restore = new ApiError(
      'manifest-drifted',
      '/Users/me/repos/shop/package.json has changes dryfit did not make.',
    );

    const { code, stderr } = await dryfit('restore', { client, cwd: '/Users/me/repos/shop' });

    expect(code).toBe(1);
    expect(stderr).toContain('dryfit: /Users/me/repos/shop/package.json has changes dryfit did not make.');
    expect(stderr).toContain('--force');
  });

  it('restores one library in a project and keeps its other links', async () => {
    const client = new FakeClient();
    client.replies.restore = { ok: true };

    const { code, stdout } = await dryfit('restore /Users/me/repos/shop --library @acme/ui', { client });

    expect(code).toBe(0);
    expect(stdout).toContain('Restored @acme/ui in ~/repos/shop');
    expect(client.calls.at(-1)).toEqual({
      name: 'restore',
      input: { consumer: '/Users/me/repos/shop', library: '@acme/ui' },
    });
  });

  it('restores the linked project a subfolder belongs to', async () => {
    const client = new FakeClient();
    client.replies.status = status({
      links: [{ library: '@acme/ui', consumer: '/Users/me/repos/shop', status: 'installed' }],
    });
    client.replies.restore = { ok: true };

    const { code } = await dryfit('restore', { client, cwd: '/Users/me/repos/shop/src/app' });

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
        throw new ApiError('manifest-drifted', 'shop has changes dryfit did not make.');
      return { ok: true };
    };

    const { code, stdout, stderr } = await dryfit('restore --all', { client });

    expect(code).toBe(1);
    expect(client.calls.filter((call) => call.name === 'restore')).toHaveLength(2);
    expect(stderr).toContain('shop has changes dryfit did not make.');
    expect(stdout).toContain('Restored ~/repos/admin');
  });

  it('exits 1 with --json too when something failed, so scripts can tell', async () => {
    const version = '1.4.1-dev.20261118143201';
    const client = new FakeClient();
    client.replies.sync = {
      version,
      published: [{ library: '@acme/ui', version }],
      installs: [
        {
          consumer: '/Users/me/repos/shop',
          ok: false,
          version,
          libraries: [{ library: '@acme/ui', version }],
          output: 'npm ERR!',
        },
      ],
    };
    const failed = [{ consumer: '/Users/me/repos/shop', status: 'failed' as const, message: 'no' }];
    client.replies.linkGroup = failed;
    client.replies.restoreGroup = failed;

    const sync = await dryfit('sync --json', { client });
    const link = await dryfit('link --group checkout --json', { client });
    const restore = await dryfit('restore --group checkout --json', { client });

    expect([sync.code, link.code, restore.code]).toEqual([1, 1, 1]);
    expect(JSON.parse(sync.stdout)).toMatchObject({ version });
  });

  it('reports an unexpected error in one line instead of crashing', async () => {
    const client = new FakeClient();
    client.replies.status = undefined as never;

    const { code, stderr } = await dryfit('status', { client });

    expect(code).toBe(1);
    expect(stderr).toContain('dryfit: unexpected error: no reply scripted for status');
  });

  it('refuses an empty --build', async () => {
    const { code, stderr, client } = await dryfit(['add', '--build', '  ']);

    expect(code).toBe(2);
    expect(stderr).toContain('--build');
    expect(client.calls).toEqual([]);
  });

  it('shows usage for an unknown command, and exits 2', async () => {
    const { code, stderr } = await dryfit('frobnicate');

    expect(code).toBe(2);
    expect(stderr).toContain('Unknown command: frobnicate');
    expect(stderr).toContain('Usage: dryfit <command>');
  });

  it('reports errors as JSON on stderr under --json, with the code and hint an agent needs', async () => {
    const client = new FakeClient();
    client.replies.unregister = new ApiError('library-linked', '@acme/ui is still linked into shop.');

    const { code, stdout, stderr } = await dryfit('remove @acme/ui --json', { client });

    expect(code).toBe(1);
    expect(stdout).toBe('');
    expect(JSON.parse(stderr)).toEqual({
      error: {
        code: 'library-linked',
        message: '@acme/ui is still linked into shop.',
        hint: 'Run `dryfit restore` for those consumers first.',
      },
      exitCode: 1,
    });
  });

  it('reports wrong usage as JSON under --json, and exits 2', async () => {
    const unknown = await dryfit('frobnicate --json');
    const badOption = await dryfit('link --frob --json');
    const missing = await dryfit('remove --json');

    for (const { code, stderr } of [unknown, badOption, missing]) {
      expect(code).toBe(2);
      expect(JSON.parse(stderr)).toMatchObject({ error: { code: 'usage' }, exitCode: 2 });
    }
    expect(JSON.parse(unknown.stderr).error.message).toBe('Unknown command: frobnicate');
  });

  it('installs the agent skill where Claude Code looks, or where it is told to', async () => {
    const agentCalls: { action: string; skillsDir: string }[] = [];

    const { code, stdout } = await dryfit('agent install', { agentCalls });
    await dryfit('agent install --project', { agentCalls, cwd: '/Users/me/repos/shop' });
    await dryfit('agent install --dir ../skills', { agentCalls, cwd: '/Users/me/repos/shop' });
    await dryfit('agent uninstall', { agentCalls, env: { CLAUDE_CONFIG_DIR: '/Users/me/.config/claude' } });

    expect(code).toBe(0);
    expect(stdout).toContain('Installed the dryfit skill: ~/.claude/skills/dryfit/SKILL.md');
    expect(agentCalls).toEqual([
      { action: 'install', skillsDir: '/Users/me/.claude/skills' },
      { action: 'install', skillsDir: '/Users/me/repos/shop/.claude/skills' },
      { action: 'install', skillsDir: '/Users/me/repos/skills' },
      { action: 'uninstall', skillsDir: '/Users/me/.config/claude/skills' },
    ]);
  });

  it('prints the agent skill, and refuses an agent action it does not know', async () => {
    const shown = await dryfit('agent show');
    const unknown = await dryfit('agent teach');

    expect(shown.stdout).toContain('name: dryfit');
    expect(unknown.code).toBe(2);
    expect(unknown.stderr).toContain('Use install, uninstall or show');
  });
});
