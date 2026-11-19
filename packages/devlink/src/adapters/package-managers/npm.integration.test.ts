import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  describePackageManagerContract,
  describePublisherContract,
} from '../../testing/package-manager.contract.ts';
import { npm, npmPublisher } from './npm.ts';

describePublisherContract(npmPublisher);

describePackageManagerContract(npm, {
  pointScopeAt: (dir, registryUrl) => writeFile(join(dir, '.npmrc'), `@fixture:registry=${registryUrl}\n`),
  install: { command: 'npm', args: ['install'] },
});
