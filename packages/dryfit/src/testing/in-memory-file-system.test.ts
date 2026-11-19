import { describeFileSystemContract } from './file-system.contract.ts';
import { InMemoryFileSystem } from './in-memory-file-system.ts';

describeFileSystemContract('InMemoryFileSystem', async () => ({
  fs: new InMemoryFileSystem(),
  root: '/tmp/contract',
}));
