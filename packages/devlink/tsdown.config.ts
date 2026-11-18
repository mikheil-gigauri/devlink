import { defineConfig } from 'tsdown';

/** One ESM entry for the CLI and the daemon it starts (ADR 0008). Dependencies stay external. */
export default defineConfig({
  entry: { devlink: 'src/cli/bin.ts' },
  format: 'esm',
  platform: 'node',
  target: 'node22.12',
  outDir: 'dist',
  clean: true,
  dts: false,
});
