import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describePackageManagerContract } from '../../testing/package-manager.contract.ts';
import { yarn } from './yarn.ts';

describePackageManagerContract(yarn, {
  // The project maps the scope in .yarnrc.yml, which Yarn lets nothing override from outside. It
  // reaches its registry as localhost and allows plain http to that host only; devlink's registry
  // is 127.0.0.1, which only the adapter's own whitelist lets in.
  pointScopeAt: (dir, registryUrl) =>
    writeFile(
      join(dir, '.yarnrc.yml'),
      [
        'nodeLinker: node-modules',
        "unsafeHttpWhitelist: ['localhost']",
        'npmScopes:',
        '  fixture:',
        `    npmRegistryServer: '${registryUrl.replace('//127.0.0.1:', '//localhost:')}'`,
        // The fixtures were released seconds ago, younger than Yarn's default age gate.
        '    npmMinimalAgeGate: 0',
        '',
      ].join('\n'),
    ),
  install: { command: 'yarn', args: ['install'] },
});
