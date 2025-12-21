//tests/unit/onboarding/ft0-insight-execution.provider.test.ts
import db from 'api-db';
import { ft0InsightExecutionSignalProvider } from 'api-src/ft0/insight-execution/insight-execution.provider';

describe('FT0 Insight Execution — Signal Provider', () => {
  const shopId = 456;

  beforeEach(async () => {
    await db('ft0_insight_executions').where({ shop_id: shopId }).del();
  });

  it('returns attempted=false when no execution exists', async () => {
    const signals = await ft0InsightExecutionSignalProvider.getSignals({ shopId });

    expect(signals).toEqual(
      expect.arrayContaining([
        { name: 'insight.execution.attempted', value: false },
        { name: 'insight.execution.status', value: null }
      ])
    );
  });

  it('returns status when execution exists', async () => {
    await db('ft0_insight_executions').insert({
      shop_id: shopId,
      status: 'SUCCESS',
      attempted_at: new Date(),
      payload: {},
      payload_hash: 'hash'
    });

    const signals = await ft0InsightExecutionSignalProvider.getSignals({ shopId });

    expect(signals).toEqual(
      expect.arrayContaining([
        { name: 'insight.execution.attempted', value: true },
        { name: 'insight.execution.status', value: 'SUCCESS' }
      ])
    );
  });
});
