import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * A fresh, empty temporary folder per call, resolved through symlinks (on macOS `/var` is a link to
 * `/private/var`, and tools report the resolved path). Call `cleanup` in `afterEach`.
 */
export async function createTempDir(
  prefix = 'dryfit-test-',
): Promise<{ path: string; cleanup: () => Promise<void> }> {
  const path = await realpath(await mkdtemp(join(tmpdir(), prefix)));
  return { path, cleanup: () => rm(path, { recursive: true, force: true }) };
}
