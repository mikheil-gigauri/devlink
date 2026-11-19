import { defineConfig } from 'tsdown';

/**
 * One ESM entry for the CLI and the daemon it starts (ADR 0008). Dependencies stay external.
 * Plain JavaScript: Node 22.12, the oldest dryfit supports, cannot load a TypeScript config.
 */
export default defineConfig({
  entry: { dryfit: 'src/cli/bin.ts' },
  format: 'esm',
  platform: 'node',
  target: 'node22.12',
  outDir: 'dist',
  clean: true,
  dts: false,
});
