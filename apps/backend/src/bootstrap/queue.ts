// apps/backend/src/bootstrap/queue.ts
// Re-exports and small helpers for queue lifecycle
import { initQueue as initImpl, closeQueue as closeImpl } from '../queue.js';

export async function initQueue(): Promise<void> {
  try {
    await initImpl();
    console.log('[bootstrap/queue] Queue init attempted');
  } catch (err) {
    console.warn('[bootstrap/queue] Failed to init queue:', err && (err as Error).message ? (err as Error).message : err);
  }
}

export async function closeQueue(): Promise<void> {
  try {
    await closeImpl();
    console.log('[bootstrap/queue] Queue closed');
  } catch (err) {
    console.warn('[bootstrap/queue] Error closing queue:', err && (err as Error).message ? (err as Error).message : err);
  }
}
