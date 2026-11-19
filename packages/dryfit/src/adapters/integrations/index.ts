import type { ConsumerIntegration } from '../../core/ports.ts';
import { angular } from './angular.ts';
import { nativeFederation } from './native-federation.ts';
import { vite } from './vite.ts';

export const builtInIntegrations: readonly ConsumerIntegration[] = [angular, nativeFederation, vite];
