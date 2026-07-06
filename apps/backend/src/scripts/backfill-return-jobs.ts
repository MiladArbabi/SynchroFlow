// apps/backend/src/scripts/backfill-return-jobs.ts
//
// ONE-TIME BACKFILL — RT2-01
// ---------------------------
// Creates return_jobs for refund_executions that predate the
// auto-spawn fix in projection/handlers/refunds.create.ts.
//
// Safe to re-run: idempotent via return_jobs_refund_execution_unique.

import crypto from 'crypto';
import db from '@lasyncro/backend-core/db.js';

const ORDER_UUID_NAMESPACE = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';

async function main() {
  const orphans = await db('refund_executions as re')
    .leftJoin('return_jobs as rj', 'rj.lasyncro_refund_execution_id', 're.lasyncro_refund_execution_id')
    .whereNull('rj.return_job_id')
    .select('re.lasyncro_refund_execution_id', 're.lasyncro_order_id', 're.shop_id', 'o.shop_id')
    .join('orders as o', 'o.lasyncro_order_id', 're.lasyncro_order_id');

  console.log(`[BACKFILL_RETURN_JOBS] Found ${orphans.length} orphaned refund(s)`);

  for (const row of orphans) {
    const returnJobId = crypto
      .createHash('sha1')
      .update(`${ORDER_UUID_NAMESPACE}:return_job:${row.lasyncro_refund_execution_id}`)
      .digest('hex')
      .slice(0, 32)
      .replace(/^(.{8})(.{4})(.{4})(.{4})(.{12}).*$/, '$1-$2-$3-$4-$5');

    await db('return_jobs')
      .insert({
        return_job_id: returnJobId,
        shop_id: row.shop_id,
        origin: 'customer_return',
        lasyncro_refund_execution_id: row.lasyncro_refund_execution_id,
        lasyncro_order_id: row.lasyncro_order_id,
        status: 'pending',
        claimed_by: null,
        source: 'backfill_rt2_01',
      })
      .onConflict('lasyncro_refund_execution_id')
      .ignore();

    console.log('[BACKFILL_RETURN_JOBS] Created job', { returnJobId, refundExecutionId: row.lasyncro_refund_execution_id });
  }

  console.log('[BACKFILL_RETURN_JOBS] Done');
  process.exit(0);
}

main().catch((err) => {
  console.error('[BACKFILL_RETURN_JOBS_FAILED]', err);
  process.exit(1);
});