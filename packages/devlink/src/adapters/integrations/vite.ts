import type { ConsumerIntegration } from '../../core/ports.ts';
import { dependsOnAny } from '../../core/project/cache-paths.ts';

/** Vite's dependency pre-bundle cache (its default `cacheDir`). */
export const vite: ConsumerIntegration = {
  id: 'vite',
  detect: (project) => dependsOnAny(project, ['vite']),
  cachePaths: () => ['node_modules/.vite'],
};
