export function useOrdersFt1Scenario(input) {
    const { ordersIngested, hasNegativeMarginOrder, missingCostCount } = input;
    console.debug('[OrdersScenario]', {
        ordersIngested,
        missingCostCount,
        hasNegativeMarginOrder,
    });
    if (ordersIngested === null)
        return 'LOADING';
    if (ordersIngested === 0)
        return 'NO_ORDERS';
    if (hasNegativeMarginOrder === true)
        return 'LOSS';
    if (missingCostCount > 0)
        return 'UNCERTAIN';
    return 'HEALTHY';
}
//# sourceMappingURL=useOrdersFt1Scenario.js.map