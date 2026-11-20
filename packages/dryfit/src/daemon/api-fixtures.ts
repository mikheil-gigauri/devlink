import type { ApiErrorBody, Health, OperationName, OperationOutputs } from './api.ts';
import type { ServerEvent } from './event-hub.ts';

/**
 * One sample of every API output and every event, as the daemon would send them (ADR 0013). They are
 * typed against the API, so changing a type fails the typecheck here until the samples follow; the
 * menu bar app's tests then decode the exported copy, which carries the change across languages.
 */

const SHOP = '/Users/me/repos/shop';
const ADMIN = '/Users/me/repos/admin';
const VERSION = '1.4.1-dev.20261118143201';
const AT = '2026-11-18T14:32:01.000Z';

const health: Health = {
  name: 'dryfit',
  version: '0.1.0',
  apiVersion: 1,
  pid: 4242,
  registryUrl: 'http://127.0.0.1:4874/',
  startedAt: '2026-11-18T09:00:00.000Z',
};

const library = {
  name: '@acme/ui',
  root: '/Users/me/repos/ui-lib/projects/ui',
  publishDir: '/Users/me/repos/ui-lib/dist/ui',
  build: {
    command: '/Users/me/repos/ui-lib/node_modules/.bin/ng',
    args: ['build', 'acme-ui'],
    cwd: '/Users/me/repos/ui-lib/projects/ui',
  },
  lastPublishedVersion: VERSION,
  watch: true,
};

const shopLink = {
  library: '@acme/ui',
  consumer: SHOP,
  status: 'installed',
  installedVersion: VERSION,
  guard: true,
} as const;

const group = { name: 'checkout', consumers: [SHOP, ADMIN] };

export const outputs = {
  status: {
    daemon: health,
    libraries: [
      library,
      { name: '@acme/forms', root: '/Users/me/repos/forms', publishDir: '/Users/me/repos/forms' },
    ],
    links: [
      shopLink,
      {
        library: '@acme/ui',
        consumer: ADMIN,
        status: 'failed',
        installedVersion: '1.4.1-dev.20261118120000',
        message: 'npm error code ERESOLVE\nnpm error ERESOLVE unable to resolve dependency tree',
      },
    ],
    groups: [group],
    warnings: [
      {
        group: 'checkout',
        library: '@acme/ui',
        versions: [
          { consumer: SHOP, version: VERSION },
          { consumer: ADMIN, version: '1.4.1-dev.20261118120000' },
        ],
      },
    ],
    jobs: {
      running: { id: 7, label: 'sync @acme/ui', key: 'sync:@acme/ui', queuedAt: AT, startedAt: AT },
      queued: [{ id: 8, label: 'restore /Users/me/repos/admin', queuedAt: AT }],
    },
  },
  register: { library, detected: 'angular' },
  unregister: { ok: true },
  inspect: {
    name: '@acme/ui',
    version: '1.4.0',
    root: '/Users/me/repos/ui-lib/projects/ui',
    detected: 'angular',
    publishDir: '/Users/me/repos/ui-lib/dist/ui',
    build: { command: '/Users/me/repos/ui-lib/node_modules/.bin/ng', args: ['build', 'ui'] },
    registered: false,
  },
  sync: {
    version: VERSION,
    published: [{ library: '@acme/ui', version: VERSION }],
    installs: [
      {
        consumer: SHOP,
        ok: true,
        version: VERSION,
        libraries: [{ library: '@acme/ui', version: VERSION }],
        clearedCaches: [`${SHOP}/.angular/cache`],
      },
      {
        consumer: ADMIN,
        ok: false,
        version: VERSION,
        libraries: [{ library: '@acme/ui', version: VERSION }],
        output: 'npm error code ERESOLVE',
      },
    ],
  },
  watch: library,
  discover: [
    {
      root: SHOP,
      name: 'shop',
      packageManager: { ok: true, name: 'npm', source: 'lockfile' },
      libraries: [{ name: '@acme/ui', field: 'dependencies', range: '^1.4.0' }],
    },
    {
      root: ADMIN,
      name: undefined,
      packageManager: {
        ok: false,
        reason: 'multiple-lockfiles',
        lockfiles: ['package-lock.json', 'yarn.lock'],
      },
      libraries: [{ name: '@acme/ui', field: 'devDependencies', range: '~1.4.0' }],
    },
  ],
  link: { link: shopLink, links: [shopLink], guard: 'installed' },
  restore: { ok: false, output: 'npm error network request failed' },
  saveGroup: group,
  deleteGroup: { ok: true },
  linkGroup: [
    { consumer: SHOP, status: 'done' },
    { consumer: ADMIN, status: 'failed', message: 'npm error ERESOLVE unable to resolve dependency tree' },
  ],
  restoreGroup: [
    { consumer: SHOP, status: 'done' },
    { consumer: ADMIN, status: 'skipped' },
  ],
  roots: { roots: ['/Users/me/repos'] },
  setRoots: { roots: ['/Users/me/repos', '/Users/me/work'] },
  hiddenApps: { hiddenApps: ['/Users/me/repos/storybook'] },
  hideApps: { hiddenApps: ['/Users/me/repos/storybook', '/Users/me/repos/old-shop'] },
  shutdown: { ok: true },
} satisfies { [K in OperationName]: OperationOutputs[K] };

type EventSamples = { [T in ServerEvent['type']]: Extract<ServerEvent, { type: T }> };

const event = <T extends ServerEvent['type']>(id: number, sample: Omit<EventSamples[T], 'id' | 'at'>) =>
  ({ id, at: AT, ...sample }) as EventSamples[T];

const job = { id: 7, label: 'sync @acme/ui', key: 'sync:@acme/ui', queuedAt: AT };

const eventSamples = {
  'build:started': event<'build:started'>(1, { type: 'build:started', library: '@acme/ui' }),
  'build:succeeded': event<'build:succeeded'>(2, { type: 'build:succeeded', library: '@acme/ui' }),
  'build:failed': event<'build:failed'>(3, {
    type: 'build:failed',
    library: '@acme/ui',
    output: "error TS2304: Cannot find name 'Butto'.",
  }),
  'publish:succeeded': event<'publish:succeeded'>(4, {
    type: 'publish:succeeded',
    library: '@acme/ui',
    version: VERSION,
  }),
  'install:started': event<'install:started'>(5, {
    type: 'install:started',
    library: '@acme/ui',
    consumer: SHOP,
    version: VERSION,
  }),
  'install:succeeded': event<'install:succeeded'>(6, {
    type: 'install:succeeded',
    library: '@acme/ui',
    consumer: SHOP,
    version: VERSION,
  }),
  'install:failed': event<'install:failed'>(7, {
    type: 'install:failed',
    library: '@acme/ui',
    consumer: ADMIN,
    version: VERSION,
    output: 'npm error code ERESOLVE',
  }),
  'caches:cleared': event<'caches:cleared'>(8, {
    type: 'caches:cleared',
    consumer: SHOP,
    paths: [`${SHOP}/.angular/cache`],
  }),
  'consumer:restored': event<'consumer:restored'>(9, {
    type: 'consumer:restored',
    consumer: SHOP,
    library: '@acme/ui',
    ok: true,
  }),
  'job:queued': event<'job:queued'>(10, { type: 'job:queued', job }),
  'job:started': event<'job:started'>(11, { type: 'job:started', job: { ...job, startedAt: AT } }),
  'job:finished': event<'job:finished'>(12, {
    type: 'job:finished',
    job: { ...job, startedAt: AT },
    error: { code: 'build-failed', message: 'Building @acme/ui failed' },
  }),
  'library:changed': event<'library:changed'>(13, { type: 'library:changed', library: '@acme/ui' }),
  'watch:failed': event<'watch:failed'>(14, {
    type: 'watch:failed',
    library: '@acme/ui',
    message: 'EMFILE: too many open files',
  }),
  'state:changed': event<'state:changed'>(15, { type: 'state:changed' }),
} satisfies EventSamples;

export const events: readonly ServerEvent[] = Object.values(eventSamples);

export const errorBody: ApiErrorBody = {
  error: {
    code: 'manifest-drifted',
    message: '/Users/me/repos/shop/package.json has changes dryfit did not make.',
    details: { path: '/Users/me/repos/shop/package.json' },
  },
};

export { health };
