import type { SpecterUiIntent } from '../intents.js';
export interface SpecterModuleProps {
    sessionCount: number | null;
    signalConfidence: number | null;
    onIntent?: (intent: SpecterUiIntent) => void;
}
/**
 * SpecterModule — FT1 Diagnostic Surface
 *
 * HARD RULES:
 * - No data fetching
 * - No routing
 * - No lifecycle awareness
 * - One scenario → one card
 */
export default function SpecterModule(props: SpecterModuleProps): import("react").JSX.Element;
