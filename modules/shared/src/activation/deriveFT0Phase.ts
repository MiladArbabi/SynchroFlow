import { FT0Phase, IntegrationSnapshot } from './types';

export function deriveFT0Phase(
  integrations: IntegrationSnapshot[],
  ft0Completed: boolean
): FT0Phase {
  if (integrations.length === 0) {
    return 'PRE_INTEGRATION';
  }

  if (ft0Completed) {
    return 'READY'; // or READY if you prefer naming
  }

  return 'SYNCING';
}
