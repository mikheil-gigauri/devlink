import type { ConsumerIntegration } from '../../core/ports.ts';
import { dependsOnAny } from '../../core/project/cache-paths.ts';
import { isRecord } from '../../core/util/json.ts';

const DEFAULT_CACHE = '.angular/cache';

/**
 * The Angular CLI pre-bundles dependencies (Vite/esbuild) into its persistent cache, which outlives
 * an install. The location can be moved with `cli.cache.path` in angular.json.
 */
export const angular: ConsumerIntegration = {
  id: 'angular',
  configFiles: ['angular.json'],

  detect: (project) => project.rootFiles.includes('angular.json') || dependsOnAny(project, ['@angular/core']),

  cachePaths(project) {
    const config = project.configs.get('angular.json');
    const cli = isRecord(config) ? config.cli : undefined;
    const cache = isRecord(cli) ? cli.cache : undefined;
    const path = isRecord(cache) ? cache.path : undefined;
    return [typeof path === 'string' && path.length > 0 ? path : DEFAULT_CACHE];
  },
};
