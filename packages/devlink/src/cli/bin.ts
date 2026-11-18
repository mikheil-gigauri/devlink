#!/usr/bin/env node
import { homedir } from 'node:os';
import { DevlinkHome } from '../adapters/node/devlink-home.ts';
import { VERSION } from '../version.ts';
import { LocalMachine } from './local.ts';
import { run } from './main.ts';
import { Output } from './output.ts';

const color = process.stdout.isTTY === true && !process.env.NO_COLOR;
const stdout = (text: string) => void process.stdout.write(text);
const stderr = (text: string) => void process.stderr.write(text);
const home = homedir();

// The first Ctrl-C (or SIGTERM from launchd) ends what is running gracefully; a second one exits.
const interrupt = new AbortController();
for (const name of ['SIGINT', 'SIGTERM'] as const) {
  process.on(name, () => {
    if (interrupt.signal.aborted) process.exit(130);
    interrupt.abort();
  });
}

const local = new LocalMachine({
  home: DevlinkHome.locate(process.env, home),
  version: VERSION,
  env: process.env,
  entry: process.argv[1] ?? '',
  out: new Output(stdout, { color, home }),
  err: new Output(stderr, { color: process.stderr.isTTY === true && !process.env.NO_COLOR, home }),
  signal: interrupt.signal,
});

const argv = process.argv.slice(2);
const code = await run(argv, {
  cwd: process.cwd(),
  env: process.env,
  home,
  stdout,
  stderr,
  connect: () => local.connect(),
  local,
  color,
  signal: interrupt.signal,
});

if (argv[0] === 'daemon' && argv[1] === 'run') {
  // Libraries the daemon loads may keep timers alive after a clean stop; the work is done.
  process.exit(code);
}
process.exitCode = code;
