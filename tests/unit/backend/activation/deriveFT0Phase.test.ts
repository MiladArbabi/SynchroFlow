// tests/unit/backend/activation/deriveFT0Phase.test.ts
import { deriveFT0Phase } from '@lasyncro/shared/activation';
import { IntegrationSnapshot } from '@lasyncro/shared/activation';

describe('deriveFT0Phase — backend-derived FT0 invariant', () => {
  const completedIntegration: IntegrationSnapshot = {
    platform: 'shopify',
    syncStatus: 'COMPLETED',
  };

  const syncingIntegration: IntegrationSnapshot = {
    platform: 'shopify',
    syncStatus: 'IN_PROGRESS',
  };

  it('returns PRE_INTEGRATION and not ready when no integrations exist', () => {
    const result = deriveFT0Phase({
      integrations: [],
      ft0InsightExecution: {
        attempted: false,
        status: null,
      },
    });

    expect(result).toEqual({
      phase: 'PRE_INTEGRATION',
      ready: false,
    });
  });

  it('returns SYNCING and not ready when integration has not completed', () => {
    const result = deriveFT0Phase({
      integrations: [syncingIntegration],
      ft0InsightExecution: {
        attempted: false,
        status: null,
      },
    });

    expect(result).toEqual({
      phase: 'SYNCING',
      ready: false,
    });
  });

  it('returns RESOLVED but not ready when integration completed but insight not attempted', () => {
    const result = deriveFT0Phase({
      integrations: [completedIntegration],
      ft0InsightExecution: {
        attempted: false,
        status: null,
      },
    });

    expect(result).toEqual({
      phase: 'RESOLVED',
      ready: false,
    });
  });

  it('returns RESOLVED and ready when insight execution SUCCESS', () => {
    const result = deriveFT0Phase({
      integrations: [completedIntegration],
      ft0InsightExecution: {
        attempted: true,
        status: 'SUCCESS',
      },
    });

    expect(result).toEqual({
      phase: 'RESOLVED',
      ready: true,
    });
  });

  it('returns RESOLVED and ready when insight execution EMPTY', () => {
    const result = deriveFT0Phase({
      integrations: [completedIntegration],
      ft0InsightExecution: {
        attempted: true,
        status: 'EMPTY',
      },
    });

    expect(result).toEqual({
      phase: 'RESOLVED',
      ready: true,
    });
  });

  it('returns RESOLVED and ready when insight execution DEGRADED', () => {
    const result = deriveFT0Phase({
      integrations: [completedIntegration],
      ft0InsightExecution: {
        attempted: true,
        status: 'DEGRADED',
      },
    });

    expect(result).toEqual({
      phase: 'RESOLVED',
      ready: true,
    });
  });

  it('returns RESOLVED but not ready when insight execution FAILED', () => {
    const result = deriveFT0Phase({
      integrations: [completedIntegration],
      ft0InsightExecution: {
        attempted: true,
        status: 'FAILED',
      },
    });

    expect(result).toEqual({
      phase: 'RESOLVED',
      ready: false,
    });
  });
});
