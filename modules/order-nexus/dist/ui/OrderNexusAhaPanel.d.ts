import React from 'react';
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
export declare function OrderNexusAhaPanel({ summary, onIntent, }: OrderNexusAhaPanelProps): React.JSX.Element | null;
export {};
