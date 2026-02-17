// NOTE:
// This gate is intentionally unused until
// real EpistemicValue inputs exist.
/**
 * Decision Epistemic Gate
 * ----------------------
 * Single authority for deciding whether an action
 * is epistemically allowed.
 *
 * HARD RULES:
 * - UNKNOWN  → block
 * - INCOMPLETE → block (advisory only)
 * - KNOWN → allow
 */
export function decisionEpistemicGate(inputs) {
    if (inputs.some(v => v.state === 'UNKNOWN')) {
        return {
            allowed: false,
            epistemicState: 'UNKNOWN',
            reason: 'INSUFFICIENT_KNOWLEDGE',
        };
    }
    if (inputs.some(v => v.state === 'INCOMPLETE')) {
        return {
            allowed: false,
            epistemicState: 'INCOMPLETE',
            reason: 'PARTIAL_KNOWLEDGE',
        };
    }
    return {
        allowed: true,
        epistemicState: 'KNOWN',
    };
}
