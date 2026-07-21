export type OrdersFt1Scenario = 'LOADING' | 'NO_ORDERS' | 'LOSS' | 'UNCERTAIN' | 'HEALTHY';
type UseOrdersFt1ScenarioInput = {
    ordersIngested: number | null;
    hasNegativeMarginOrder: boolean;
    missingCostCount: number;
};
export declare function useOrdersFt1Scenario(input: UseOrdersFt1ScenarioInput): OrdersFt1Scenario;
export {};
