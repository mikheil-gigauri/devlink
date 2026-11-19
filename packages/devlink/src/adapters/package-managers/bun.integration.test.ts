import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describePackageManagerContract } from '../../testing/package-manager.contract.ts';
import { bun } from './bun.ts';

describePackageManagerContract(bun, {
  pointScopeAt: (dir, registryUrl) => writeFile(join(dir, '.npmrc'), `@fixture:registry=${registryUrl}\n`),
  install: { command: 'bun', args: ['install'] },
});
