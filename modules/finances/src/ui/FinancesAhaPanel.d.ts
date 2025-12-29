import { FinancesUiIntent } from './intents';
interface FinancesAhaSummary {
    hasRisk: boolean;
    riskCount: number;
    severity: 'low' | 'medium' | 'high';
}
interface FinancesAhaPanelProps {
    summary: FinancesAhaSummary;
    onIntent: (intent: FinancesUiIntent) => void;
}
export declare function FinancesAhaPanel({ summary, onIntent, }: FinancesAhaPanelProps): import("react/jsx-runtime").JSX.Element | null;
export {};
