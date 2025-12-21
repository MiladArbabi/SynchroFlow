//tests/unit/onboarding/ft0-insight-execution.executor.test.ts
import db from 'api-db';
import { executeFt0InsightIfNeeded } from 'api-src/ft0/insight-execution/insight-execution.executor';

describe('FT0 Insight Execution — Executor', () => {
  const shopId = 123;

  beforeEach(async () => {
    await db('ft0_insight_executions').where({ shop_id: shopId }).del();
  });

  it('executes when no prior execution exists', async () => {
    await executeFt0InsightIfNeeded({ shopId });

    const rows = await db('ft0_insight_executions').where({ shop_id: shopId });
    expect(rows.length).toBe(1);
  });

  it('does not re-execute after SUCCESS', async () => {
    await db('ft0_insight_executions').insert({
      shop_id: shopId,
      status: 'SUCCESS',
      attempted_at: new Date(),
      payload: {},
      payload_hash: 'hash'
    });

    await executeFt0InsightIfNeeded({ shopId });

    const rows = await db('ft0_insight_executions').where({ shop_id: shopId });
    expect(rows.length).toBe(1);
  });

  it('persists EMPTY when no canonical data exists', async () => {
    await executeFt0InsightIfNeeded({ shopId });

    const row = await db('ft0_insight_executions')
      .where({ shop_id: shopId })
      .first();

    expect(row.status).toBe('EMPTY');
  });

  it('persists FAILED on execution error', async () => {
    await executeFt0InsightIfNeeded({ shopId, forceError: true });

    const row = await db('ft0_insight_executions')
      .where({ shop_id: shopId })
      .first();

    expect(row.status).toBe('FAILED');
  });
});
