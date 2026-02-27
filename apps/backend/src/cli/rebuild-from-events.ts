/**
 * ENVIRONMENT BOOTSTRAP
 * ---------------------
 * CLI must explicitly load .env.
 */
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

dotenv.config({
  path: path.resolve(__dirname, '../../../../.env'),
});

import db from '@lasyncro/backend-core/db.js';
import { processMessage } from '../worker.js';

async function truncateProjections() {
  console.log('[REBUILD] Truncating projection tables...');

  await db.raw(`
    TRUNCATE TABLE
      orders,
      order_line_items,
      order_revenue_units,
      refund_executions,
      refund_execution_line_items
    RESTART IDENTITY CASCADE;
  `);

  await db('projection_cursors').del();
}

async function replayEvents() {
  console.log('[REBUILD] Replaying domain events...');

  const events = await db('domain_events')
    .orderBy('id', 'asc')
    .select('id');

  for (const event of events) {
    await processMessage({
      content: Buffer.from(
        JSON.stringify({ domain_event_id: event.id })
      ),
    } as any);
  }
}

async function main() {
  console.log('[REBUILD] Starting full deterministic rebuild...');

  await truncateProjections();
  await replayEvents();

  console.log('[REBUILD] Completed successfully.');
  process.exit(0);
}

main().catch((err) => {
  console.error('[REBUILD] Failed:', err);
  process.exit(1);
});