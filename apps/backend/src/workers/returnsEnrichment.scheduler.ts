// apps/backend/src/workers/returnsEnrichment.scheduler.ts

import db from 'api-src/db';
import { getQueueChannel } from 'api-src/queue';

export async function enqueuePendingReturnEnrichments() {
  // RETURNS DEPRECATED — no-op
  return;
}
