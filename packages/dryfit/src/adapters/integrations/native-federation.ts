import type { ConsumerIntegration } from '../../core/ports.ts';
import { dependsOnAny } from '../../core/project/cache-paths.ts';

/** Native Federation caches the bundles it builds for shared packages, keyed by package version. */
export const nativeFederation: ConsumerIntegration = {
  id: 'native-federation',
  detect: (project) =>
    dependsOnAny(project, ['@angular-architects/native-federation', '@softarc/native-federation']),
  cachePaths: () => ['node_modules/.cache/native-federation'],
};
