function nowISO() {
    return new Date().toISOString();
}
function computeCompletenessRatio(fulfilled, unfulfilled, unknown) {
    const knownTotal = fulfilled + unfulfilled;
    const total = knownTotal + unknown;
    if (total <= 0)
        return undefined;
    return knownTotal / total;
}
function toEpistemicNumber(value, facts) {
    const { fulfilled, unfulfilled, unknown } = facts.revenue;
    const knownTotal = fulfilled + unfulfilled;
    if (facts.visibility.status === 'sufficient') {
        return {
            value,
            state: 'KNOWN',
            evaluatedAt: nowISO(),
        };
    }
    if (knownTotal > 0) {
        return {
            value,
            state: 'INCOMPLETE',
            explanation: facts.visibility.reason ?? 'INSUFFICIENT_EXECUTION_VISIBILITY',
            completenessRatio: computeCompletenessRatio(fulfilled, unfulfilled, unknown),
            evaluatedAt: nowISO(),
        };
    }
    return {
        value: null,
        state: 'UNKNOWN',
        explanation: facts.visibility.reason ?? 'NO_EXECUTION_DATA',
        evaluatedAt: nowISO(),
    };
}
/**
 * Public API — Epistemic Revenue Projection
 */
export function computeExecutionAwareRevenueEpistemic(facts) {
    return {
        fulfilled: toEpistemicNumber(facts.revenue.fulfilled, facts),
        unfulfilled: toEpistemicNumber(facts.revenue.unfulfilled, facts),
        unknown: toEpistemicNumber(facts.revenue.unknown, facts),
    };
}
/**
 * Aggregate Revenue Epistemic
 * ---------------------------
 * Pure aggregation over execution-aware revenue buckets.
 *
 * Rules:
 * - Sum of values ONLY if epistemically allowed
 * - State derived strictly via epistemic rules
 * - No inference
 */
export function aggregateRevenueEpistemic(input) {
    const values = [input.fulfilled, input.unfulfilled, input.unknown];
    if (values.some(v => v.state === 'UNKNOWN')) {
        return {
            value: null,
            state: 'UNKNOWN',
            explanation: 'INSUFFICIENT_REVENUE_KNOWLEDGE',
            evaluatedAt: new Date().toISOString(),
        };
    }
    if (values.some(v => v.state === 'INCOMPLETE')) {
        return {
            value: (input.fulfilled.value ?? 0) +
                (input.unfulfilled.value ?? 0),
            state: 'INCOMPLETE',
            explanation: 'PARTIAL_REVENUE_KNOWLEDGE',
            evaluatedAt: new Date().toISOString(),
        };
    }
    return {
        value: (input.fulfilled.value ?? 0) +
            (input.unfulfilled.value ?? 0) +
            (input.unknown.value ?? 0),
        state: 'KNOWN',
        evaluatedAt: new Date().toISOString(),
    };
}
