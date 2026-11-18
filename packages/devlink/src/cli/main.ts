import { isAbsolute, resolve } from 'node:path';
import { type ParseArgsConfig, parseArgs } from 'node:util';
import { DevlinkError } from '../core/errors.ts';
import type { LibraryRecord } from '../core/model.ts';
import type { OperationOutputs, StatusView } from '../daemon/api.ts';
import type { HubEvent } from '../daemon/event-hub.ts';
import { VERSION } from '../version.ts';
import { type ApiClient, ApiError } from './client.ts';
import { Output, renderEvent } from './output.ts';

/** Everything that touches this machine directly rather than through the daemon. */
export interface LocalControl {
  init(roots: readonly string[]): Promise<{ readonly home: string; readonly roots: readonly string[] }>;
  daemon(action: 'start' | 'stop' | 'restart' | 'status' | 'run' | 'install' | 'uninstall'): Promise<number>;
  doctor(out: Output, json: boolean): Promise<number>;
}

export interface RunContext {
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
  /** The user's home folder, shown as `~`. */
  readonly home: string;
  readonly stdout: (text: string) => void;
  readonly stderr: (text: string) => void;
  /** A client for a running daemon, starting one if needed. */
  readonly connect: () => Promise<ApiClient>;
  readonly local?: LocalControl;
  readonly color: boolean;
  /** Aborts on Ctrl-C, ending commands that follow events. */
  readonly signal?: AbortSignal;
}

interface Command {
  readonly options?: ParseArgsConfig['options'];
  run(input: CommandInput): Promise<number>;
}

interface CommandInput {
  readonly positionals: readonly string[];
  readonly values: Readonly<Record<string, string | boolean | (string | boolean)[] | undefined>>;
  readonly ctx: RunContext;
  readonly out: Output;
  readonly err: Output;
  readonly json: boolean;
}

/** An expected problem with how the CLI was used, reported without a stack trace. */
class CliError extends Error {
  readonly exitCode: number;
  constructor(message: string, exitCode = 1) {
    super(message);
    this.exitCode = exitCode;
  }
}

const USAGE = `Usage: devlink <command> [options]

Set up
  init [--root <dir>]...        Choose where your projects live and start devlink
  add [dir]                     Register the library in dir (default: here)
      --publish-dir <dir>       Folder to publish, when it cannot be detected
      --build "<command>"       Build command, when it cannot be detected
  remove <library>              Forget a library

Linking
  consumers [library]           List the projects that use your libraries
  link <consumer>...            Install dev builds of a library into consumers
      --library <name>          Which library (default: the one here, or the only one)
      --group <name>            Link every consumer in a saved group
      --no-guard                Do not add the pre-commit guard
  restore [consumer]...         Put consumers back exactly as they were (alias: unlink)
      --group <name>  --all  --force

Working
  sync [library]                Build, publish and install into linked consumers now
  watch [library]               Sync on every change; Ctrl-C stops following, not watching
      --detach                  Turn watching on and return
  unwatch [library]             Stop syncing on change
  status                        Libraries, links, groups and warnings
  events                        Follow what the daemon is doing

Groups
  group save <name> <consumer>...   Save consumers that run together
  group delete <name>
  group list

Daemon
  daemon start|stop|restart|status
  daemon install|uninstall      Start devlink at login (launchd)
  doctor                        Check that everything is in order

Every command accepts --json.
`;

/** Runs one CLI invocation and returns its exit code. */
export async function run(argv: readonly string[], ctx: RunContext): Promise<number> {
  const out = new Output(ctx.stdout, { color: ctx.color, home: ctx.home });
  const err = new Output(ctx.stderr, { color: ctx.color, home: ctx.home });
  const [name, ...rest] = argv;

  if (name === undefined || name === 'help' || name === '--help' || name === '-h') {
    out.line(USAGE.trimEnd());
    return 0;
  }
  if (name === '--version' || name === '-v') {
    out.line(VERSION);
    return 0;
  }
  const command = COMMANDS[name];
  if (!command) {
    err.line(`Unknown command: ${name}\n`);
    err.line(USAGE.trimEnd());
    return 2;
  }

  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseArgs({
      args: [...rest],
      allowPositionals: true,
      strict: true,
      options: { json: { type: 'boolean' }, ...command.options },
    });
  } catch (error) {
    err.line(`devlink ${name}: ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }

  const json = parsed.values.json === true;
  try {
    return await command.run({ positionals: parsed.positionals, values: parsed.values, ctx, out, err, json });
  } catch (error) {
    return reportError(err, error);
  }
}

function reportError(err: Output, error: unknown): number {
  if (error instanceof CliError) {
    err.line(`devlink: ${error.message}`);
    return error.exitCode;
  }
  if (explain(err, error)) return 1;
  err.line(`devlink: unexpected error: ${error instanceof Error ? error.message : String(error)}`);
  err.line(err.dim('This is a bug in devlink. The daemon log may say more: ~/.devlink/logs/daemon.log'));
  return 1;
}

/** Prints an error devlink knows about (message, captured output, hint); false for anything else. */
function explain(err: Output, error: unknown): error is ApiError | DevlinkError {
  if (!(error instanceof ApiError || error instanceof DevlinkError)) return false;
  err.line(`devlink: ${error.message}`);
  const output = error.details.output;
  if (typeof output === 'string' && output.length > 0) err.output(output);
  const hint = HINTS[error.code];
  if (hint) err.line(err.dim(hint));
  return true;
}

const HINTS: Partial<Record<string, string>> = {
  'manifest-drifted':
    'Commit or stash those changes first, or run `devlink restore --force` to overwrite them.',
  'library-not-found': 'Run `devlink status` to see registered libraries, or `devlink add` in the library.',
  'not-a-consumer': 'Check the path, or run `devlink consumers` to see which projects use the library.',
  'library-linked': 'Run `devlink restore` for those consumers first.',
  'snapshot-missing': 'devlink has nothing to restore there: it was never linked, or was already restored.',
  'daemon-unavailable': 'Start it with `devlink daemon start`, or run `devlink doctor`.',
  'daemon-failed': 'See `devlink doctor` and the log in ~/.devlink/logs/daemon.log.',
  unauthorized: 'The token changed since the daemon started. Run `devlink daemon restart`.',
  'invalid-config': 'Fix the file, or delete it and run `devlink init` again.',
  'group-not-found': 'Run `devlink group list` to see saved groups.',
};

const absolute = (ctx: RunContext, path: string) =>
  isAbsolute(path) ? resolve(path) : resolve(ctx.cwd, path);

const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];

const string = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined);

/**
 * The library a command is about: the one named, else the registered library whose folder contains
 * the current one, else the only registered library.
 */
function resolveLibrary(status: StatusView, named: string | undefined, cwd: string): string {
  if (named) return named;
  const containing = status.libraries
    .filter((library) => cwd === library.root || cwd.startsWith(`${library.root}/`))
    .sort((a, b) => b.root.length - a.root.length)[0];
  if (containing) return containing.name;
  const [only, ...others] = status.libraries;
  if (only && others.length === 0) return only.name;
  if (!only) throw new CliError('No library is registered yet. Run `devlink add` in your library first.');
  throw new CliError(
    `Which library? Pass --library: ${status.libraries.map((library) => library.name).join(', ')}`,
  );
}

/** Prints a result for scripts; the exit code still says whether everything succeeded. */
/** The linked project `cwd` is in (the nearest, for nested projects), or `cwd` itself. */
function linkedProjectAround(status: StatusView, cwd: string): string {
  return (
    status.links
      .map((link) => link.consumer)
      .filter((consumer) => cwd === consumer || cwd.startsWith(`${consumer}/`))
      .sort((a, b) => b.length - a.length)[0] ?? cwd
  );
}

function printJson(out: Output, value: unknown, exitCode = 0): number {
  out.line(JSON.stringify(value, null, 2));
  return exitCode;
}

const anyFailed = (outcomes: readonly { readonly status: string }[]) =>
  outcomes.some((outcome) => outcome.status === 'failed') ? 1 : 0;

/**
 * Runs `task` while printing the daemon's events, subscribing first so that none are missed.
 * `relevant` filters what is shown.
 */
async function withProgress<T>(
  input: CommandInput,
  client: ApiClient,
  relevant: (event: HubEvent) => boolean,
  task: () => Promise<T>,
): Promise<T> {
  if (input.json) return task();
  const controller = new AbortController();
  const opened = new Promise<void>((resolveOpen) => {
    client
      .events((event) => relevant(event) && renderEvent(input.out, event, { jobs: false }), {
        signal: controller.signal,
        onOpen: resolveOpen,
      })
      .catch(() => resolveOpen());
  });
  await opened;
  try {
    return await task();
  } finally {
    controller.abort();
  }
}

const aboutLibrary = (library: string) => (event: HubEvent) =>
  'library' in event ? event.library === library : event.type === 'consumer:restored';

/** Follows events until Ctrl-C. */
async function follow(input: CommandInput, client: ApiClient, relevant: (event: HubEvent) => boolean) {
  const signal = input.ctx.signal ?? new AbortController().signal;
  await client.events(
    (event) => {
      if (!relevant(event)) return;
      if (input.json) input.out.line(JSON.stringify(event));
      else renderEvent(input.out, event, { jobs: true });
    },
    { signal },
  );
}

function describeLibrary(out: Output, library: LibraryRecord): string {
  const build = library.build
    ? `${[library.build.command.split('/').at(-1), ...library.build.args].join(' ')} → `
    : '';
  return `${build}${out.path(library.publishDir)}`;
}

const COMMANDS: Record<string, Command> = {
  init: {
    options: { root: { type: 'string', multiple: true } },
    async run({ values, ctx, out, json }) {
      const local = requireLocal(ctx);
      const roots = strings(values.root).map((root) => absolute(ctx, root));
      const result = await local.init(roots.length > 0 ? roots : [resolve(ctx.cwd, '..')]);
      const client = await ctx.connect();
      const status = await client.call('status', {});
      if (json) return printJson(out, { ...result, registryUrl: status.daemon.registryUrl });
      out.ok('devlink is ready');
      out.line(`  home      ${out.path(result.home)}`);
      out.line(`  roots     ${result.roots.map(out.path).join(', ')}`);
      out.line(`  registry  ${status.daemon.registryUrl}`);
      out.line();
      out.line(
        `Next: run ${out.bold('devlink add')} in a library, then ${out.bold('devlink link <consumer>')}.`,
      );
      return 0;
    },
  },

  add: {
    options: { 'publish-dir': { type: 'string' }, build: { type: 'string' } },
    async run({ positionals, values, ctx, out, json }) {
      const root = absolute(ctx, positionals[0] ?? '.');
      const publishDir = string(values['publish-dir']);
      const build = string(values.build)?.trim().split(/\s+/);
      if (build?.[0] === '')
        throw new CliError('--build needs a command, such as --build "npm run build"', 2);
      const client = await ctx.connect();
      const result = await client.call('register', {
        root,
        ...(publishDir !== undefined && { publishDir: absolute({ ...ctx, cwd: root }, publishDir) }),
        ...(build?.[0] !== undefined && { build: { command: build[0], args: build.slice(1) } }),
      });
      if (json) return printJson(out, result);
      const how = result.detected === 'given' ? '' : out.dim(` (detected: ${result.detected})`);
      out.ok(`Registered ${out.bold(result.library.name)}: ${describeLibrary(out, result.library)}${how}`);
      out.line(
        `Next: ${out.bold('devlink consumers')} to see who uses it, then ${out.bold('devlink link <consumer>')}.`,
      );
      return 0;
    },
  },

  remove: {
    async run({ positionals, ctx, out, json }) {
      const library = positionals[0];
      if (!library) throw new CliError('Which library? Usage: devlink remove <library>', 2);
      const result = await (await ctx.connect()).call('unregister', { library });
      if (json) return printJson(out, result);
      out.ok(`Removed ${library}`);
      return 0;
    },
  },

  consumers: {
    async run({ positionals, ctx, out, json }) {
      const client = await ctx.connect();
      const [found, status] = await Promise.all([
        client.call('discover', positionals[0] ? { library: positionals[0] } : {}),
        client.call('status', {}),
      ]);
      if (json) return printJson(out, found);
      if (found.length === 0) {
        out.line(
          'No consumers found. Add the folders your projects live in with `devlink init --root <dir>`.',
        );
        return 0;
      }
      const linked = new Set(status.links.map((link) => `${link.library}\u0000${link.consumer}`));
      for (const consumer of found) {
        out.line(`${out.bold(consumer.name ?? '(unnamed)')}  ${out.dim(out.path(consumer.root))}`);
        for (const library of consumer.libraries) {
          const state = linked.has(`${library.name}\u0000${consumer.root}`) ? out.green('linked') : '';
          out.line(`  ${library.name} ${out.dim(library.range)}  ${state}`.trimEnd());
        }
      }
      return 0;
    },
  },

  link: {
    options: {
      library: { type: 'string' },
      group: { type: 'string' },
      'no-guard': { type: 'boolean' },
    },
    async run(input) {
      const { positionals, values, ctx, out, json } = input;
      const client = await ctx.connect();
      const library = resolveLibrary(await client.call('status', {}), string(values.library), ctx.cwd);
      const group = string(values.group);
      if (group) {
        const outcomes = await client.call('linkGroup', { group, library });
        if (json) return printJson(out, outcomes, anyFailed(outcomes));
        for (const outcome of outcomes) {
          if (outcome.status === 'done') out.ok(`Linked ${library} into ${out.path(outcome.consumer)}`);
          else if (outcome.status === 'skipped')
            out.step(`Skipped ${out.path(outcome.consumer)}: ${outcome.message}`);
          else out.fail(`${out.path(outcome.consumer)}: ${outcome.message}`);
        }
        return anyFailed(outcomes);
      }

      if (positionals.length === 0)
        throw new CliError('Which consumers? Usage: devlink link <consumer>...', 2);
      const results = [];
      let failed = 0;
      for (const consumer of positionals.map((path) => absolute(ctx, path))) {
        let result: OperationOutputs['link'];
        try {
          result = await client.call('link', {
            library,
            consumer,
            ...(values['no-guard'] === true && { guard: false }),
          });
        } catch (error) {
          // One consumer's problem should not stop the others from being linked.
          if (!(error instanceof ApiError || error instanceof DevlinkError)) throw error;
          failed = 1;
          results.push({ consumer, error: { code: error.code, message: error.message } });
          if (!json) explain(input.err, error);
          continue;
        }
        results.push(result);
        if (json) continue;
        const notes = ['snapshot taken'];
        if (result.guard === 'installed') notes.push('commit guard installed');
        if (result.guard === 'not-a-repo') notes.push('not a git repository, so no commit guard');
        out.ok(`Linked ${library} into ${out.path(consumer)} ${out.dim(`(${notes.join(', ')})`)}`);
        if (result.link.installedVersion) out.line(out.dim(`  running ${result.link.installedVersion}`));
      }
      if (json) return printJson(out, results, failed);
      if (failed === 0)
        out.line(
          `Next: ${out.bold('devlink sync')} to build and install, or ${out.bold('devlink watch')} to do it on every change.`,
        );
      return failed;
    },
  },

  restore: restoreCommand(),
  unlink: restoreCommand(),

  sync: {
    async run(input) {
      const { positionals, ctx, out, json } = input;
      const client = await ctx.connect();
      const library = resolveLibrary(await client.call('status', {}), positionals[0], ctx.cwd);
      let result: Awaited<ReturnType<typeof client.call<'sync'>>>;
      try {
        result = await withProgress(input, client, aboutLibrary(library), () =>
          client.call('sync', { library }),
        );
      } catch (error) {
        // The build or publish output has already been shown as it happened.
        if (
          !json &&
          error instanceof ApiError &&
          (error.code === 'build-failed' || error.code === 'publish-failed')
        ) {
          throw new CliError(error.message);
        }
        throw error;
      }
      const failed = result.installs.filter((install) => !install.ok).length;
      if (json) return printJson(out, result, failed > 0 ? 1 : 0);
      if (result.installs.length === 0) out.line(out.dim('Nothing is linked yet, so nothing was installed.'));
      else if (failed > 0)
        out.line(out.red(`${failed} of ${result.installs.length} consumers did not take ${result.version}.`));
      return failed > 0 ? 1 : 0;
    },
  },

  watch: {
    options: { detach: { type: 'boolean' } },
    async run(input) {
      const { positionals, values, ctx, out, json } = input;
      const client = await ctx.connect();
      const library = resolveLibrary(await client.call('status', {}), positionals[0], ctx.cwd);
      const record = await client.call('watch', { library, enabled: true });
      if (json && values.detach === true) return printJson(out, record);
      if (!json) out.ok(`Watching ${library}: every change builds, publishes and installs`);
      if (values.detach === true) return 0;
      if (!json)
        out.line(
          out.dim(
            'Following its activity. Ctrl-C stops following; watching continues until `devlink unwatch`.',
          ),
        );
      await follow(input, client, aboutLibrary(library));
      return 0;
    },
  },

  unwatch: {
    async run({ positionals, ctx, out, json }) {
      const client = await ctx.connect();
      const library = resolveLibrary(await client.call('status', {}), positionals[0], ctx.cwd);
      const record = await client.call('watch', { library, enabled: false });
      if (json) return printJson(out, record);
      out.ok(`Stopped watching ${library}`);
      return 0;
    },
  },

  status: {
    async run({ ctx, out, json }) {
      const status = await (await ctx.connect()).call('status', {});
      if (json) return printJson(out, status);
      printStatus(out, status);
      return 0;
    },
  },

  events: {
    async run(input) {
      const client = await input.ctx.connect();
      if (!input.json) input.out.line(input.out.dim('Following devlink. Ctrl-C to stop.'));
      await follow(input, client, () => true);
      return 0;
    },
  },

  group: {
    async run({ positionals, ctx, out, json }) {
      const [action, name, ...consumers] = positionals;
      const client = await ctx.connect();
      if (action === 'list' || action === undefined) {
        const { groups } = await client.call('status', {});
        if (json) return printJson(out, groups);
        if (groups.length === 0)
          out.line('No groups yet. Save one with `devlink group save <name> <consumer>...`.');
        for (const group of groups)
          out.line(`${out.bold(group.name)}  ${group.consumers.map(out.path).join(', ')}`);
        return 0;
      }
      if (!name) throw new CliError(`Usage: devlink group ${action} <name>`, 2);
      if (action === 'save') {
        if (consumers.length === 0) throw new CliError('Usage: devlink group save <name> <consumer>...', 2);
        const group = await client.call('saveGroup', {
          name,
          consumers: consumers.map((path) => absolute(ctx, path)),
        });
        if (json) return printJson(out, group);
        out.ok(`Saved group ${group.name}: ${group.consumers.map(out.path).join(', ')}`);
        return 0;
      }
      if (action === 'delete') {
        const result = await client.call('deleteGroup', { name });
        if (json) return printJson(out, result);
        out.ok(`Deleted group ${name}`);
        return 0;
      }
      throw new CliError(`Unknown group action: ${action}. Use save, delete or list.`, 2);
    },
  },

  daemon: {
    async run({ positionals, ctx }) {
      const action = positionals[0] ?? 'status';
      const actions = ['start', 'stop', 'restart', 'status', 'run', 'install', 'uninstall'] as const;
      const known = actions.find((candidate) => candidate === action);
      if (!known) throw new CliError(`Unknown daemon action: ${action}. Use ${actions.join(', ')}.`, 2);
      return requireLocal(ctx).daemon(known);
    },
  },

  doctor: {
    async run({ ctx, out, json }) {
      return requireLocal(ctx).doctor(out, json);
    },
  },
};

function restoreCommand(): Command {
  return {
    options: { group: { type: 'string' }, all: { type: 'boolean' }, force: { type: 'boolean' } },
    async run(input) {
      const { positionals, values, ctx, out, json } = input;
      const client = await ctx.connect();
      const force = values.force === true ? { force: true } : {};
      const group = string(values.group);
      if (group) {
        const outcomes = await client.call('restoreGroup', { group, ...force });
        if (json) return printJson(out, outcomes, anyFailed(outcomes));
        for (const outcome of outcomes) {
          if (outcome.status === 'done') out.ok(`Restored ${out.path(outcome.consumer)}`);
          else if (outcome.status === 'skipped')
            out.step(`Skipped ${out.path(outcome.consumer)}: not linked`);
          else out.fail(`${out.path(outcome.consumer)}: ${outcome.message}`);
        }
        return anyFailed(outcomes);
      }

      let consumers = positionals.map((path) => absolute(ctx, path));
      if (values.all === true) {
        consumers = [...new Set((await client.call('status', {})).links.map((link) => link.consumer))];
        if (consumers.length === 0) out.line('Nothing is linked.');
      } else if (consumers.length === 0) {
        consumers = [linkedProjectAround(await client.call('status', {}), ctx.cwd)];
      }

      const results = [];
      let failed = false;
      for (const consumer of consumers) {
        let result: OperationOutputs['restore'];
        try {
          result = await client.call('restore', { consumer, ...force });
        } catch (error) {
          // One consumer's problem should not leave the others linked.
          if (!(error instanceof ApiError || error instanceof DevlinkError)) throw error;
          failed = true;
          results.push({ consumer, ok: false, error: { code: error.code, message: error.message } });
          if (!json) explain(input.err, error);
          continue;
        }
        results.push({ consumer, ...result });
        if (!result.ok) failed = true;
        if (json) continue;
        if (result.ok) out.ok(`Restored ${out.path(consumer)}`);
        else {
          out.fail(`Restored the files of ${out.path(consumer)}, but the clean install failed:`);
          out.output(result.output);
        }
      }
      return json ? printJson(out, results, failed ? 1 : 0) : failed ? 1 : 0;
    },
  };
}

function printStatus(out: Output, status: StatusView): void {
  const { daemon, jobs } = status;
  const activity = jobs.running
    ? `running ${jobs.running.label}${jobs.queued.length > 0 ? ` (+${jobs.queued.length} queued)` : ''}`
    : 'idle';
  out.line(out.dim(`devlink ${daemon.version} · registry ${daemon.registryUrl} · ${activity}`));

  out.line();
  out.line(out.bold('Libraries'));
  if (status.libraries.length === 0) out.line(out.dim('  None yet. Run `devlink add` in a library folder.'));
  for (const library of status.libraries) {
    const notes = [
      library.lastPublishedVersion ? `last ${library.lastPublishedVersion}` : 'not published yet',
      ...(library.watch ? [out.cyan('watching')] : []),
    ];
    out.line(`  ${out.bold(library.name)}  ${out.dim(out.path(library.root))}  ${notes.join('  ')}`);
  }

  out.line();
  out.line(out.bold('Links'));
  if (status.links.length === 0) out.line(out.dim('  None. Link a consumer with `devlink link <consumer>`.'));
  for (const link of status.links) {
    const state =
      link.status === 'installed'
        ? out.green(`installed ${link.installedVersion ?? ''}`.trimEnd())
        : link.status === 'failed'
          ? out.red('last install failed')
          : out.yellow('waiting for the first sync');
    out.line(
      `  ${link.library} → ${out.path(link.consumer)}  ${state}${link.guard ? out.dim('  guarded') : ''}`,
    );
  }

  if (status.groups.length > 0) {
    out.line();
    out.line(out.bold('Groups'));
    for (const group of status.groups)
      out.line(`  ${group.name}  ${out.dim(group.consumers.map(out.path).join(', '))}`);
  }

  if (status.warnings.length > 0) {
    out.line();
    for (const warning of status.warnings) {
      const versions = warning.versions
        .map((entry) => `${out.path(entry.consumer)} ${entry.version}`)
        .join(', ');
      out.warn(
        `${warning.group} runs different versions of ${warning.library}: ${versions}. Run \`devlink sync\`.`,
      );
    }
  }
}

function requireLocal(ctx: RunContext): LocalControl {
  if (!ctx.local) throw new CliError('This command needs local access to the machine.');
  return ctx.local;
}
