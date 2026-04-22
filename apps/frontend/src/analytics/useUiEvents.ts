// apps/frontend/src/analytics/useUiEvents.ts

import { useCallback } from 'react';
import { sendEvent } from '../analytics/adapter';


/**
 * CENTRAL ANALYTICS LAYER
 *
 * RULES:
 * - Single entry point for all tracking
 * - Enforces naming + structure
 * - Prevents vendor lock-in
 * - Prevents event chaos
 */

export type UiEventName =
  | 'ui.intent'
  | 'auth.signup.success'
  | 'auth.signup.failed'
  | 'auth.login.success'
  | 'auth.login.failed'
  | 'integration.connect.started'
  | 'integration.connect.failed'
  | 'integration.connect.back'
  | 'integration.connect.cancelled'
  // 'integration.connect.redirected'
  // Fired AFTER backend returns OAuth URL and BEFORE hard redirect.
  // Critical for measuring drop-off before OAuth handoff.
  | 'integration.connect.redirected'
  | 'integration.platform.selected';

export type UiEventPayload = Record<string, unknown>;

export function useUiEvents() {
    const emit = useCallback((event: UiEventName, payload: UiEventPayload = {}) => {
    console.info('[analytics:emit]', event);

    sendEvent(event, payload);

  }, []);

  return { emit };
}