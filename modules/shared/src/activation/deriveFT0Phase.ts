import { FT0Phase, IntegrationSnapshot } from './types';

export function deriveFT0Phase(
  integrations: IntegrationSnapshot[]
): FT0Phase {
  if (integrations.length === 0) {
    return 'PRE_INTEGRATION';
  }

  const hasCompleted = integrations.some(
    i => i.syncStatus === 'COMPLETED'
  );

  if (hasCompleted) {
    return 'RESOLVED';
  }

  return 'SYNCING';
}
