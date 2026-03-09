import { PanelRow, PanelFooter } from '@lasyncro/ui-ft2';
import type { OperationalSignal } from '../../contracts/operationalSignals.js';
import { getSignalIcon, getSeverityPriority } from '../helpers/signalSeverity.js';
import { Button, Stack } from '@mui/material';

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
  signals,
  onAction,
}: OperationsQueueSectionProps) {

  /**
   * Severity-based ordering
   * -----------------------
   * Ensures operational triage always surfaces
   * the most critical signals first.
   */
  const orderedSignals = [...signals].sort(
    (a, b) =>
      getSeverityPriority(a.severity) -
      getSeverityPriority(b.severity)
  );

  return (
   <>

      {orderedSignals.map((signal) => (
        <div key={signal.id}>
          <PanelRow
            label={`${getSignalIcon(signal.severity)} ${signal.title}`}
            value={signal.impact}
          />

          {signal.metadata && (
            <PanelRow
              label="Details"
              value={JSON.stringify(signal.metadata)}
            />
          )}

          {signal.actions && signal.actions.length > 0 && (
            <Stack direction="row" spacing={1} sx={{ pl: 3, pb: 1 }}>
              {signal.actions.map((action) => (
                <Button
                  key={action.id}
                  size="small"
                  variant="outlined"
                  onClick={() => {
                    /**
                     * Operational intent emission
                     * ---------------------------
                     * Emits actionType to parent orchestration layer.
                     *
                     * If no handler is provided we emit a clear
                     * diagnostic signal instead of silently failing.
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
            </Stack>
          )}

          {signal.batchActions && signal.batchActions.length > 0 && (
            <Stack
              direction="row"
              spacing={1}
              sx={{
                pl: 3,
                pb: 1,
                borderTop: '1px dashed rgba(0,0,0,0.1)',
                mt: 1,
                pt: 1,
              }}
            >
              {signal.batchActions.map((action) => (
                <Button
                  key={action.id}
                  size="small"
                  variant="contained"
                  color="primary"
                  onClick={() => {
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
            </Stack>
          )}
        </div>
      ))}

      <PanelFooter
        line1="> OPERATIONAL SIGNAL CLUSTERS"
        line2="> SOURCE: orders_operational_control_snapshot"
      />

   </>
  );
}