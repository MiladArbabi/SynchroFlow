// apps/backend/src/api/webhooks/dispatchMode.ts
//
// Phase 6A – Dispatch Mode Declaration
//
// This module is intentionally tiny.
// Its only job is to make dispatch mode explicit and validated.
//
// Supported modes:
// - sync (default)
//
// Future modes (NOT implemented here):
// - async
// - queued
//

export type WebhookDispatchMode = 'sync' | 'queued';

const ALLOWED_MODES: WebhookDispatchMode[] = ['sync', 'queued'];

export function getWebhookDispatchMode(): WebhookDispatchMode {
  const raw = process.env.WEBHOOK_DISPATCH_MODE;

  if (!raw) {
    return 'sync';
  }

  if (ALLOWED_MODES.includes(raw as WebhookDispatchMode)) {
    return raw as WebhookDispatchMode;
  }

  throw new Error(
    `Invalid WEBHOOK_DISPATCH_MODE "${raw}". ` +
    `Allowed values: ${ALLOWED_MODES.join(', ')}`
  );
}