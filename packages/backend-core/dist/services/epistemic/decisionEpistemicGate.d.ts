import type { EpistemicValue } from '@lasyncro/epistemic';
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
export declare function decisionEpistemicGate(inputs: EpistemicValue<any>[]): {
    allowed: boolean;
    epistemicState: 'KNOWN' | 'INCOMPLETE' | 'UNKNOWN';
    reason?: string;
};
