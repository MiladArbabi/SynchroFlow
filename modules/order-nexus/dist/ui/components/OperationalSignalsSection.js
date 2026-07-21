import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "react/jsx-runtime";
import { FT2SignalBanner } from '@lasyncro/ui-ft2';
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
export function OperationalSignalsSection({ signals, queues, onSignalAction, onQueueAction }) {
    /**
     * SIGNAL ESCALATION ORDERING
     * --------------------------
     * Critical operational incidents must appear first.
     *
     * This preserves Control Tower escalation semantics:
     * system failures → workload queues → informational signals.
     */
    const criticalSignals = signals.filter((s) => s.severity === 'critical');
    const nonCriticalSignals = signals.filter((s) => s.severity !== 'critical');
    const orderedSignals = [...criticalSignals, ...nonCriticalSignals];
    return (_jsxs(_Fragment, { children: [orderedSignals.map((signal) => (_jsx(FT2SignalBanner, { severity: signal.severity, title: signal.title, description: signal.impact, actionLabel: signal.actions?.[0]?.label, onAction: () => {
                    const action = signal.actions?.[0];
                    if (!action)
                        return;
                    if (onSignalAction) {
                        onSignalAction(action.actionType, signal);
                    }
                } }, `signal-${signal.id}`))), queues.map((queue) => (_jsx(FT2SignalBanner, { severity: "info", title: queue.title, description: `${queue.count} orders`, actionLabel: queue.actions?.[0]?.label, onAction: () => {
                    const action = queue.actions?.[0];
                    if (!action)
                        return;
                    if (onQueueAction) {
                        onQueueAction(action.intent, queue);
                    }
                } }, `queue-${queue.id}`)))] }));
}
//# sourceMappingURL=OperationalSignalsSection.js.map