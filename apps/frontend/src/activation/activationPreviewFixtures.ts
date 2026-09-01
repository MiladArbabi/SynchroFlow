import type { SyncAnimationSnapshot } from './SyncAnimationExperience';

export type ActivationPreviewScenarioId =
  | 'initial'
  | 'tiny'
  | 'fast'
  | 'normal'
  | 'long'
  | 'very-long'
  | 'completed'
  | 'failed'
  | 'reconnect';

export interface ActivationPreviewFixture {
  id: ActivationPreviewScenarioId;
  label: string;
  firstActivation: boolean;
  completesAfterMs: number | null;
  startsFailed: boolean;
  initialElapsedMs: number;
}

export const ACTIVATION_PREVIEW_FIXTURES: Record<ActivationPreviewScenarioId, ActivationPreviewFixture> = {
  initial: {
    id: 'initial',
    label: 'Initial',
    firstActivation: true,
    completesAfterMs: null,
    startsFailed: false,
    initialElapsedMs: 0,
  },
  tiny: {
    id: 'tiny',
    label: 'Tiny sync',
    firstActivation: true,
    completesAfterMs: 500,
    startsFailed: false,
    initialElapsedMs: 0,
  },
  fast: {
    id: 'fast',
    label: 'Fast sync',
    firstActivation: true,
    completesAfterMs: 5000,
    startsFailed: false,
    initialElapsedMs: 0,
  },
  normal: {
    id: 'normal',
    label: 'Normal sync',
    firstActivation: true,
    completesAfterMs: 17000,
    startsFailed: false,
    initialElapsedMs: 0,
  },
  long: {
    id: 'long',
    label: 'Long sync',
    firstActivation: true,
    completesAfterMs: null,
    startsFailed: false,
    initialElapsedMs: 26000,
  },
  'very-long': {
    id: 'very-long',
    label: 'Very long sync',
    firstActivation: true,
    completesAfterMs: null,
    startsFailed: false,
    initialElapsedMs: 46000,
  },
  completed: {
    id: 'completed',
    label: 'Completed',
    firstActivation: true,
    completesAfterMs: 0,
    startsFailed: false,
    initialElapsedMs: 0,
  },
  failed: {
    id: 'failed',
    label: 'Failed',
    firstActivation: true,
    completesAfterMs: null,
    startsFailed: true,
    initialElapsedMs: 0,
  },
  reconnect: {
    id: 'reconnect',
    label: 'Reconnect',
    firstActivation: false,
    completesAfterMs: 5000,
    startsFailed: false,
    initialElapsedMs: 0,
  },
} as const;

export const ACTIVATION_PREVIEW_PROGRESS_FIXTURES = {
  unknownTotal: {
    current: 0,
    total: 0,
    percentage: 0,
  },
  partial: {
    current: 42,
    total: 500,
    percentage: 8.4,
  },
  nearComplete: {
    current: 480,
    total: 500,
    percentage: 96,
  },
  complete: {
    current: 500,
    total: 500,
    percentage: 100,
  },
} as const;

export function getActivationPreviewSnapshot(
  scenarioId: ActivationPreviewScenarioId,
  elapsedMs: number,
  forcedStatus?: 'COMPLETED' | 'FAILED' | null
): SyncAnimationSnapshot {
  const fixture = ACTIVATION_PREVIEW_FIXTURES[scenarioId];
  const status =
    forcedStatus ??
    (fixture.startsFailed
      ? 'FAILED'
      : fixture.completesAfterMs !== null && elapsedMs >= fixture.completesAfterMs
        ? 'COMPLETED'
        : elapsedMs <= 0
          ? 'PENDING'
          : 'SYNCING');

  const progress =
    status === 'COMPLETED'
      ? ACTIVATION_PREVIEW_PROGRESS_FIXTURES.complete
      : status === 'FAILED'
        ? ACTIVATION_PREVIEW_PROGRESS_FIXTURES.partial
        : scenarioId === 'initial'
          ? ACTIVATION_PREVIEW_PROGRESS_FIXTURES.unknownTotal
          : scenarioId === 'very-long'
            ? ACTIVATION_PREVIEW_PROGRESS_FIXTURES.nearComplete
            : ACTIVATION_PREVIEW_PROGRESS_FIXTURES.partial;

  return {
    status,
    progress,
    counts: {
      products: status === 'PENDING' ? 0 : 39,
      variants: status === 'PENDING' ? 0 : 142,
      orders: status === 'PENDING' ? 0 : 87,
      customers: status === 'PENDING' ? 0 : 63,
    },
    lastError: status === 'FAILED'
      ? 'Shopify sync stopped before completion. Reconnect and try again.'
      : null,
  };
}

export function shouldEnableActivationPreviewRoute(isDev: boolean): boolean {
  return isDev;
}
