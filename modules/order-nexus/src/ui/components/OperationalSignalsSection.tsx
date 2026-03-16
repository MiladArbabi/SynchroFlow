import { FT2SignalBanner } from '@lasyncro/ui-ft2';

import type { OperationalSignal } from '../../contracts/operationalSignals.js';
import type { WorkQueueItem } from '../../contracts/workQueue.js';

export interface OperationalSignalsSectionProps {
  signals: OperationalSignal[];
  queues: WorkQueueItem[];
  onSignalAction?: (actionType: string, signal: OperationalSignal) => void;
  onQueueAction?: (actionType: string, queue: WorkQueueItem) => void;
}

/**
 * OPERATIONAL SIGNALS SURFACE
 * ---------------------------
 * Unified Control Tower surface rendering:
 *
 * - Operational incidents
 * - Operational workload queues
 *
 * All rendered using FT2SignalBanner.
 */
export function OperationalSignalsSection({
  signals,
  queues,
  onSignalAction,
  onQueueAction
}: OperationalSignalsSectionProps) {

    /**
     * SIGNAL ESCALATION ORDERING
     * --------------------------
     * Critical operational incidents must appear first.
     *
     * This preserves Control Tower escalation semantics:
     * system failures → workload queues → informational signals.
     */
    const criticalSignals = signals.filter(
    (s) => s.severity === 'critical'
    );

    const nonCriticalSignals = signals.filter(
    (s) => s.severity !== 'critical'
    );

    const orderedSignals = [...criticalSignals, ...nonCriticalSignals];

  return (
    <>

      {orderedSignals.map((signal) => (

        <FT2SignalBanner
          key={`signal-${signal.id}`}
          severity={signal.severity}
          title={signal.title}
          description={signal.impact}
          actionLabel={signal.actions?.[0]?.label}
          onAction={() => {
            const action = signal.actions?.[0];
            if (!action) return;

            if (onSignalAction) {
              onSignalAction(action.actionType, signal);
            }
          }}
        />

      ))}

      {queues.map((queue) => (

        <FT2SignalBanner
          key={`queue-${queue.id}`}
          severity="info"
          title={queue.title}
          description={`${queue.count} orders`}
          actionLabel={queue.actions?.[0]?.label}
          onAction={() => {
            const action = queue.actions?.[0];
            if (!action) return;

            if (onQueueAction) {
              onQueueAction(action.intent, queue);
            }
          }}
        />

      ))}

    </>
  );
}