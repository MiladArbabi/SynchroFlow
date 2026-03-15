import { FT2Panel, PanelRow, PanelFooter, PanelActions, PanelBlock } from '@lasyncro/ui-ft2';
import type { OperationalSignal } from '../../contracts/operationalSignals.js';
import { getSignalIcon } from '../helpers/signalSeverity.js';
import { Button } from '@mui/material';

/**
 * OperationsQueueSection
 * ----------------------
 * Operational execution surface replacing Priority Stack.
 *
 * DATA SOURCE
 * orders_operational_control_snapshot
 *
 * DESIGN RULES
 * - No order ranking
 * - No health scores
 * - Display operational signals only
 * - Signals represent clusters of operational work
 */

export interface OperationsQueueSectionProps {
  /**
   * FT2Row layout participation.
   *
   * Allows this surface to participate in the
   * Control Tower span layout engine.
   */
  span?: number;

  /**
   * Operational signals derived from snapshot data.
   */
  signals: OperationalSignal[];

  /**
   * Explicit action dispatcher.
   *
   * Design rule:
   * The queue surface does not perform business logic.
   * It emits operational intents which higher layers handle.
   *
   * This prevents hidden side effects and allows
   * instrumentation and audit logging.
   */
  onAction?: (actionType: string, signal: OperationalSignal) => void;
}

export function OperationsQueueSection({
  span = 1,
  signals,
  onAction,
}: OperationsQueueSectionProps) {

  /**
   * Formats signal detection age.
   *
   * Guardrails:
   * - Prevents invalid timestamps from producing
   *   multi-decade time deltas.
   * - Ensures UI never displays corrupted operational age.
   */
  function formatSignalAge(detectedAt: string): string {
    if (!detectedAt) {
      return 'unknown';
    }

    const detected = new Date(detectedAt).getTime();

    /**
     * Invalid timestamp guard
     */
    if (Number.isNaN(detected) || detected <= 0) {
      return 'unknown';
    }

    const now = Date.now();
    const diffMinutes = Math.floor((now - detected) / 60000);

    if (diffMinutes < 1) return 'just now';
    if (diffMinutes === 1) return '1 min ago';
    if (diffMinutes < 60) return `${diffMinutes} min ago`;

    const diffHours = Math.floor(diffMinutes / 60);

    if (diffHours === 1) return '1 hour ago';

    /**
     * Prevent unrealistic operational age
     * (signals older than 30 days indicate upstream issue)
     */
    if (diffHours > 720) {
      console.warn('[OperationsQueue] Invalid signal timestamp', detectedAt);
      return 'timestamp error';
    }

    return `${diffHours} hours ago`;
  }

  /**
   * Signals must arrive pre-sorted by the upstream resolver.
   *
   * Rationale
   * ---------
   * Rendering surfaces must not implement operational logic.
   * Ordering belongs to the resolver / mapping layer so the
   * UI remains a pure rendering surface.
   *
   * If ordering is incorrect, investigate:
   *   mapOperationalSignals()
   *   FT2 resolver layer
   */
  const orderedSignals = signals;

  /**
   * CRITICAL SIGNAL EXTRACTION
   * --------------------------
   * Separate critical operational failures so they
   * appear first and receive visual escalation.
   *
   * This preserves deterministic ordering while
   * ensuring operators immediately see system failures.
   */
  const criticalSignals = orderedSignals.filter(
    (s) => s.severity === 'critical'
  );

  const nonCriticalSignals = orderedSignals.filter(
    (s) => s.severity !== 'critical'
  );

  const displaySignals = [...criticalSignals, ...nonCriticalSignals];

  /**
   * DEBUG SIGNAL EXPOSURE
   * ---------------------
   * Provides runtime visibility into the operational
   * signal payload for audit and diagnostics.
   *
   * This is intentionally attached to the window object
   * so engineers can inspect the exact signal payload
   * the UI receives.
   *
   * Example:
   *   window.__LAST_OPERATIONAL_SIGNALS__
   */
  if (typeof window !== 'undefined') {
    (window as any).__LAST_OPERATIONAL_SIGNALS__ = orderedSignals;
    /**
     * CRITICAL SIGNAL DIAGNOSTICS
     * ---------------------------
     * Exposes only critical signals so engineers can quickly
     * inspect whether the escalation pipeline is functioning.
     *
     * Usage:
     *   window.__CRITICAL_OPERATIONAL_SIGNALS__
     */
    (window as any).__CRITICAL_OPERATIONAL_SIGNALS__ =
      orderedSignals.filter((s) => s.severity === 'critical');
  }

  /**
   * EMPTY STATE
   * -----------
   * When no operational signals are detected,
   * the queue must render an explicit system state.
   *
   * This prevents operators from misinterpreting
   * an empty panel as a rendering failure.
   */
  const isEmpty = orderedSignals.length === 0;

  return (
   <FT2Panel
      title="Operations Queue"
      span={span}
    >
      {isEmpty && (
        <PanelBlock>
          <PanelRow
            label="No operational signals detected"
            value="All monitored operational queues are currently clear"
          />
        </PanelBlock>
      )}
      
      {/*
        * Render operational signals only when queue is non-empty.
        * Empty-state block above provides the canonical zero-state surface.
        */ }
      {!isEmpty && displaySignals.map((signal) => (
        <PanelBlock
          key={signal.id}
          sx={{
            position: 'relative',
            paddingLeft: '12px',
          }}
        >
          {/* Severity stripe */}
          <span
            style={{
              position: 'absolute',
              left: 0,
              top: 6,
              bottom: 6,
              width: 4,
              borderRadius: 2,
              background:
                signal.severity === 'critical'
                  ? '#dc2626' // red
                  : signal.severity === 'warning'
                  ? '#f59e0b' // amber
                  : '#9ca3af', // neutral,
            }}
          />

          {/** SIGNAL ROW 1
          * ------------
          * Primary signal identity.
          * Displays the operational issue and lifecycle state.*/ }
          <PanelRow
            label={`${getSignalIcon(signal.severity)} ${signal.title}`}
            value={`[${signal.lifecycle}]`}
          />

          {/** SIGNAL ROW 2
          * ------------
          * Operational context.
          * 🚨 Operational exception detected
              [NEW]
              8 orders need intervention
              $742 revenue at risk
          */}
          <PanelRow
            label={signal.impact}
            value={
              signal.impactDetail ??
              (
                /**
                 * Operational aging fallback
                 * --------------------------
                 * Must NOT rely on truthiness because `0` is a valid
                 * deterministic output from the signal builder.
                 *
                 * Explicit null/undefined guard ensures metadata
                 * visibility during debugging and prevents silent UI gaps.
                 */
                signal.metadata?.oldest_waiting_hours !== undefined
                  ? `Oldest order waiting: ${signal.metadata.oldest_waiting_hours}h`
                  : ''
              )
            }
          />

          {((signal.actions && signal.actions.length > 0) ||
            (signal.batchActions && signal.batchActions.length > 0)) && (
            <PanelActions>

              {signal.actions?.map((action) => (
                <Button
                  key={action.id}
                  size="small"
                  variant="outlined"
                  sx={{ width: 'auto', whiteSpace: 'nowrap' }}
                  onClick={() => {
                    /**
                     * UI emits intent only.
                     * Lifecycle transitions handled by signal engine / orchestration layer.
                     */
                    if (onAction) {
                      onAction(action.actionType, signal);
                    } else {
                      console.warn(
                        `[OperationsQueue] No action handler registered for`,
                        action.actionType
                      );
                    }
                  }}
                >
                  {action.label}
                </Button>
              ))}

              {signal.batchActions?.map((action) => (
                <Button
                  key={action.id}
                  size="small"
                  variant="contained"
                  sx={{ width: 'auto', whiteSpace: 'nowrap' }}
                  color="primary"
                  onClick={() => {
                    /**
                     * Lifecycle transitions must occur outside the rendering surface.
                     */
                    if (onAction) {
                      onAction(action.actionType, signal);
                    } else {
                      console.warn(
                        `[OperationsQueue] No batch action handler registered for`,
                        action.actionType
                      );
                    }
                  }}
                >
                  {action.label}
                </Button>
              ))}

            </PanelActions>
          )}
        </PanelBlock>
      ))}

      <PanelFooter
        line1="> OPERATIONAL SIGNAL CLUSTERS"
        line2="> SOURCE: orders_operational_control_snapshot"
      />

   </FT2Panel>
  );
}