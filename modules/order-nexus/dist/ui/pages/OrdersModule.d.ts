/**
 * OrdersModule — FT1 Diagnostic Surface
 * ------------------------------------
 * Purpose:
 * - Render the first truthful, read-only diagnostic state for Order-Nexus.
 *
 * FT1 Invariants:
 * - No data fetching
 * - No lifecycle awareness
 * - No onboarding logic
 * - No optimization or recommendations
 * - Renders exactly ONE diagnostic message based on scenario
 *
 * Scenario source of truth:
 * - useOrdersFt1Scenario(props)
 *
 * If this file starts "helping" the user, FT1 is broken.
 */
import type { OrderNexusUiIntent } from '../intents.js';
export interface OrdersModuleProps {
    ordersIngested: number | null;
    hasNegativeMarginOrder: boolean;
    missingCostCount: number;
    onIntent?: (intent: OrderNexusUiIntent) => void;
}
export default function OrdersModule(props: OrdersModuleProps): import("react/jsx-runtime").JSX.Element;
