// apps/backend/src/workers/returnsEnrichment.scheduler.ts

import db from 'api-src/db';
import { getQueueChannel } from 'api-src/queue';

export async function enqueuePendingReturnEnrichments() {
  const rows = await db('canonical_returns')
    .whereIn('enrichment_status', ['pending', 'retrying'])
    .where(q =>
      q.whereNull('next_enrichment_at').orWhere('next_enrichment_at', '<=', db.fn.now())
    )
    .limit(50)
    .select('canonical_return_id');

  const ch = getQueueChannel('returns.enrichment.v1');

  for (const r of rows) {
    ch.sendToQueue(
      'returns.enrichment.v1',
      Buffer.from(JSON.stringify({ canonical_return_id: r.canonical_return_id }))
    );
  }
}
