import type { HubEvent } from '../daemon/event-hub.ts';

/** Terminal output with optional color. Color is off when NO_COLOR is set or output is not a TTY. */
export class Output {
  readonly #write: (text: string) => void;
  readonly #color: boolean;
  readonly #home: string;

  constructor(write: (text: string) => void, options: { readonly color: boolean; readonly home: string }) {
    this.#write = write;
    this.#color = options.color;
    this.#home = options.home;
  }

  line(text = ''): void {
    this.#write(`${text}\n`);
  }

  bold = (text: string) => this.#paint(1, 22, text);
  dim = (text: string) => this.#paint(2, 22, text);
  green = (text: string) => this.#paint(32, 39, text);
  red = (text: string) => this.#paint(31, 39, text);
  yellow = (text: string) => this.#paint(33, 39, text);
  cyan = (text: string) => this.#paint(36, 39, text);

  ok = (text: string) => this.line(`${this.green('✓')} ${text}`);
  fail = (text: string) => this.line(`${this.red('✗')} ${text}`);
  step = (text: string) => this.line(`${this.dim('•')} ${text}`);
  warn = (text: string) => this.line(`${this.yellow('!')} ${text}`);

  /** A path with the home folder shown as `~`. */
  path = (path: string) =>
    path === this.#home
      ? '~'
      : path.startsWith(`${this.#home}/`)
        ? `~${path.slice(this.#home.length)}`
        : path;

  /** The end of a command's output, indented, which is where npm and builders put the error. */
  output(text: string, lines = 15): void {
    const tail = text.trimEnd().split('\n').slice(-lines);
    for (const entry of tail) this.line(this.dim(`    ${entry}`));
  }

  #paint(open: number, close: number, text: string): string {
    return this.#color ? `\u001b[${open}m${text}\u001b[${close}m` : text;
  }
}

/** Prints one pipeline or daemon event as a line of progress. Job bookkeeping only when `jobs`. */
export function renderEvent(out: Output, event: HubEvent, options: { readonly jobs: boolean }): void {
  switch (event.type) {
    case 'build:started':
      out.step(`Building ${event.library}…`);
      return;
    case 'build:succeeded':
      out.ok(`Built ${event.library}`);
      return;
    case 'build:failed':
      out.fail(`Build of ${event.library} failed`);
      out.output(event.output);
      return;
    case 'publish:succeeded':
      out.ok(`Published ${event.library}@${out.cyan(event.version)}`);
      return;
    case 'install:started':
      out.step(`Installing into ${out.path(event.consumer)}…`);
      return;
    case 'install:succeeded':
      out.ok(`Installed into ${out.path(event.consumer)}`);
      return;
    case 'install:failed':
      out.fail(`Install into ${out.path(event.consumer)} failed`);
      out.output(event.output);
      return;
    case 'caches:cleared':
      out.line(out.dim(`  cleared ${event.paths.join(', ')}`));
      return;
    case 'consumer:restored':
      if (event.library !== undefined) {
        if (event.ok) out.ok(`Restored ${event.library} in ${out.path(event.consumer)}`);
        else
          out.fail(`Restored ${event.library} in ${out.path(event.consumer)}, but the clean install failed`);
      } else if (event.ok) out.ok(`Restored ${out.path(event.consumer)}`);
      else out.fail(`Restored the files of ${out.path(event.consumer)}, but the clean install failed`);
      return;
    case 'library:changed':
      out.step(`${event.library} changed`);
      return;
    case 'watch:failed':
      out.fail(`Stopped watching ${event.library}: ${event.message}. Run \`devlink watch\` to start again.`);
      return;
    case 'job:started':
      if (options.jobs) out.line(out.bold(event.job.label));
      return;
    case 'job:finished':
      if (options.jobs && event.error) out.fail(`${event.job.label}: ${event.error.message}`);
      return;
    case 'job:queued':
    case 'state:changed':
      return;
  }
}
