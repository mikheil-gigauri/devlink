import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describePackageManagerContract } from '../../testing/package-manager.contract.ts';
import { pnpm } from './pnpm.ts';

describePackageManagerContract(pnpm, {
  pointScopeAt: (dir, registryUrl) => writeFile(join(dir, '.npmrc'), `@fixture:registry=${registryUrl}\n`),
  // The fixtures are seconds old, so pnpm records them in pnpm-workspace.yaml's minimumReleaseAgeExclude,
  // as it would for a real project's fresh dependencies; its frozen installs then accept them.
  install: { command: 'pnpm', args: ['install'] },
});
