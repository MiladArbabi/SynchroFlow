import db from 'api-db';
import crypto from 'crypto';

type Ft0InsightExecutionStatus = 'SUCCESS' | 'EMPTY' | 'DEGRADED' | 'FAILED';

export async function executeFt0InsightIfNeeded({
  shopId,
  forceError
}: {
  shopId: number;
  forceError?: boolean;
}): Promise<void> {
  // 1. Do not re-execute after SUCCESS
  const existingSuccess = await db('ft0_insight_executions')
    .where({ shop_id: shopId, status: 'SUCCESS' })
    .first();

  if (existingSuccess) return;

  let status: Ft0InsightExecutionStatus = 'EMPTY';
  let payload: any = {};

  try {
    if (forceError) {
      throw new Error('Forced execution error');
    }

    // Minimal FT0 reality: no canonical insight engine yet
    // Absence of data → EMPTY (deterministic)
    status = 'EMPTY';
    payload = { reason: 'no_canonical_data' };
  } catch (err) {
    status = 'FAILED';
    payload = { error: (err as Error).message };
  }

  const payloadHash = crypto
    .createHash('sha256')
    .update(JSON.stringify(payload))
    .digest('hex');

  await db('ft0_insight_executions').insert({
    shop_id: shopId,
    status,
    attempted_at: new Date(),
    payload,
    payload_hash: payloadHash
  });
}