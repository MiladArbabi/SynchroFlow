import { FT2Panel, PanelRow, PanelFooter, PanelActions, PanelBlock } from '@lasyncro/ui-ft2';
import type { WorkQueueItem } from '../../contracts/workQueue.js';
import { Button } from '@mui/material';

/**
 * WorkQueueSection
 * ----------------
 * Operational workload surface.
 *
 * DATA SOURCE
 * orders_operational_control_snapshot
 *
 * DESIGN RULES
 * - Displays workload queues
 * - No business logic
 * - No aggregation
 * - Pure projection rendering
 *
 * ARCHITECTURE
 * Signals → problems
 * Queues  → workload
 */

export interface WorkQueueSectionProps {
  span?: number;
  /**
   * Deterministic workload queues derived
   * from reconciliation projection.
   */
  queues: WorkQueueItem[];

  /**
   * Intent dispatcher.
   *
   * UI emits operational intent only.
   * Higher orchestration layers handle routing,
   * workflows and execution.
   */
  onAction?: (actionType: string, queue: WorkQueueItem) => void;
}

export function WorkQueueSection({
  span = 1,
  queues,
  onAction,
}: WorkQueueSectionProps) {

  /**
   * Queues must arrive pre-sorted.
   *
   * Ordering responsibility belongs to
   * the mapping layer (`mapWorkQueues`).
   */
  const orderedQueues = queues;

  /**
   * Explicit empty state.
   */
  const isEmpty = orderedQueues.length === 0;

  return (
    <FT2Panel title="Work Queue" id="work-queue" span={span}>

      {isEmpty && (
        <PanelBlock>
          <PanelRow
            label="No operational workload"
            value="All operational queues are currently clear"
          />
        </PanelBlock>
      )}

      {!isEmpty && orderedQueues.map((queue) => (
        <PanelBlock
          key={queue.id}
          id={`queue-${queue.id}`}
          sx={{
            position: 'relative',
            paddingLeft: '12px',
          }}
        >

          {/* QUEUE ROW 1
              ----------
              Queue identity */}
          <PanelRow
            label={queue.title}
            value={
              queue.count === 0
                ? 'No orders'
                : `${queue.count} ${queue.count === 1 ? 'order' : 'orders'}`
            }
          />

          {/* QUEUE ROW 2
              ----------
              Operational context */}
          <PanelRow
            label={queue.description}
            value=""
          />

          {queue.actions && queue.actions.length > 0 && (
            <PanelActions>

              {queue.actions.map((action) => (
                <Button
                  key={action.id}
                  size="small"
                  variant="outlined"
                  sx={{ width: 'auto', whiteSpace: 'nowrap' }}
                  onClick={() => {

                    /**
                     * Rendering surfaces emit intent only.
                     * No workflow execution here.
                     */
                    if (onAction) {
                      onAction(action.intent, queue);
                    } else {
                      console.warn(
                        `[WorkQueue] No action handler registered`,
                        action.intent
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
        line1="> OPERATIONAL WORKLOAD QUEUES"
        line2="> SOURCE: orders_operational_control_snapshot"
      />

    </FT2Panel>
  );
}