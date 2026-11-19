import { type CommandSpec, type DryfitState, EMPTY_STATE } from '../core/model.ts';
import type {
  Clock,
  CommandResult,
  DryfitEvent,
  EventSink,
  ProcessRunner,
  RunSpec,
  StateStore,
} from '../core/ports.ts';

export const ok = (stdout = ''): CommandResult => ({ exitCode: 0, stdout, stderr: '' });
export const failed = (stderr: string, exitCode = 1): CommandResult => ({ exitCode, stdout: '', stderr });

/** `npm install @acme/ui@1.0.0 --save-exact`: the command as a person would type it. */
export const commandLine = (spec: CommandSpec): string => [spec.command, ...spec.args].join(' ');

type Responder = (spec: CommandSpec) => CommandResult | Promise<CommandResult>;

/**
 * Records every command and answers with scripted results. Responders registered later win, so a
 * test can override a default. Unmatched commands succeed with empty output.
 */
export class FakeProcessRunner implements ProcessRunner {
  readonly calls: RunSpec[] = [];
  readonly #responders: { readonly prefix: string; readonly respond: Responder }[] = [];

  /** Answers commands whose command line starts with `prefix`. */
  on(prefix: string, respond: Responder | CommandResult): this {
    this.#responders.unshift({ prefix, respond: typeof respond === 'function' ? respond : () => respond });
    return this;
  }

  /** Command lines run so far, optionally only those in `cwd`. */
  lines(cwd?: string): string[] {
    return this.calls.filter((call) => cwd === undefined || call.cwd === cwd).map(commandLine);
  }

  async run(spec: RunSpec): Promise<CommandResult> {
    this.calls.push(spec);
    const line = commandLine(spec);
    const responder = this.#responders.find(({ prefix }) => line.startsWith(prefix));
    return responder ? responder.respond(spec) : ok();
  }
}

export class FakeClock implements Clock {
  #now: Date;

  constructor(iso = '2026-11-18T14:32:01Z') {
    this.#now = new Date(iso);
  }

  now(): Date {
    return new Date(this.#now);
  }

  advance(seconds: number): void {
    this.#now = new Date(this.#now.getTime() + seconds * 1000);
  }
}

export class MemoryStateStore implements StateStore {
  #state: DryfitState;

  constructor(initial: DryfitState = EMPTY_STATE) {
    this.#state = initial;
  }

  get current(): DryfitState {
    return this.#state;
  }

  async load(): Promise<DryfitState> {
    return structuredClone(this.#state);
  }

  async save(state: DryfitState): Promise<void> {
    this.#state = structuredClone(state);
  }
}

export class RecordingEventSink implements EventSink {
  readonly events: DryfitEvent[] = [];

  emit(event: DryfitEvent): void {
    this.events.push(event);
  }

  types(): DryfitEvent['type'][] {
    return this.events.map((event) => event.type);
  }
}
