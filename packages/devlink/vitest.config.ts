import { defineConfig } from 'vitest/config';

/**
 * Two projects (ADR 0009): `unit` is fast and runs on every save; `integration` starts real
 * registries and runs real package managers, so it is slower and runs in CI and before commits.
 */
export default defineConfig({
  test: {
    restoreMocks: true,
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['src/**/*.test.ts'],
          exclude: ['src/**/*.integration.test.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'integration',
          include: ['src/**/*.integration.test.ts'],
          testTimeout: 120_000,
          hookTimeout: 120_000,
          // Package managers share caches and registries on disk; run these files one at a time.
          fileParallelism: false,
        },
      },
    ],
  },
});
