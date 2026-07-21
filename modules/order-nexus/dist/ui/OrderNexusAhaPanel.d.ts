import { OrderNexusUiIntent } from './intents.js';
interface OrderNexusAhaSummary {
    hasRisk: boolean;
    riskCount: number;
    severity: 'low' | 'medium' | 'high';
}
interface OrderNexusAhaPanelProps {
    summary: OrderNexusAhaSummary;
    onIntent: (intent: OrderNexusUiIntent) => void;
}
export declare function OrderNexusAhaPanel({ summary, onIntent, }: OrderNexusAhaPanelProps): import("react/jsx-runtime").JSX.Element | null;
export {};
