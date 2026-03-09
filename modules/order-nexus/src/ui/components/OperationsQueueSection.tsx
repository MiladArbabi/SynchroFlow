import { FT2Panel, PanelRow, PanelFooter, PanelActions, PanelBlock } from '@lasyncro/ui-ft2';import type { OperationalSignal } from '../../contracts/operationalSignals.js';
import { getSignalIcon, getSeverityPriority } from '../helpers/signalSeverity.js';
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
   <FT2Panel title="Operations Queue">

      {orderedSignals.map((signal) => (
        <PanelBlock key={signal.id}>
          <PanelRow
            label={`${getSignalIcon(signal.severity)} ${signal.title}`}
            value={signal.impact}
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