"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.calculateTotalInventoryValue = calculateTotalInventoryValue;
exports.getDemandForecastForSku = getDemandForecastForSku;
exports.simulatePaymentDelay = simulatePaymentDelay;
// packages/api/src/services/forecasting.service.ts
const db_1 = __importDefault(require("../db"));
const axios_1 = __importDefault(require("axios")); // Import axios
// The URL of our running AI microservice
const AI_ENGINE_URL = 'http://127.0.0.1:8000';
async function calculateTotalInventoryValue() {
    const allInventory = await (0, db_1.default)('inventory_truth').select('price', 'quantity_available');
    const totalValue = allInventory.reduce((total, item) => {
        const price = parseFloat(item.price);
        return total + (item.quantity_available * price);
    }, 0);
    return totalValue;
}
// --- NEW FUNCTION ---
async function getDemandForecastForSku(sku) {
    try {
        // 1. Fetch historical sales data for the given SKU from our database.
        // For now, we'll simulate this with a hardcoded array.
        // In the future, we would query the 'orders' or 'financial_transactions' table.
        // 1. Fetch REAL historical sales data for the given SKU from the database.
        const salesRecords = await (0, db_1.default)('historical_sales')
            .where({ sku: sku })
            .orderBy('sale_date', 'asc');
        if (salesRecords.length < 2) {
            throw new Error('Not enough historical data to generate a forecast.');
        }
        // 2. Extract just the quantity_sold into a simple array.
        const historical_sales = salesRecords.map((record) => record.quantity_sold);
        // 3. Make an API call to our Python AI Engine with the live data.
        const response = await axios_1.default.post(`${AI_ENGINE_URL}/predict/demand`, {
            sku: sku,
            historical_sales: historical_sales
        });
        // 4. Return the forecast.
        return response.data;
    }
    catch (error) {
        console.error("Error fetching forecast from AI engine:", error);
        throw new Error('Failed to retrieve demand forecast.');
    }
}
function simulatePaymentDelay(currentCashFlow, paymentDetails) {
    const { amount, original_due_week, delay_weeks } = paymentDetails;
    // Create a copy of the original cash flow to avoid modifying it
    const simulatedFlow = [...currentCashFlow];
    // Check for invalid inputs to prevent errors
    const newDueWeek = original_due_week + delay_weeks;
    if (original_due_week >= simulatedFlow.length || newDueWeek >= simulatedFlow.length) {
        throw new Error('Payment due week is outside the forecast period.');
    }
    // Simulate the delay:
    // 1. Add the payment amount back to the original week (since it's not being paid)
    simulatedFlow[original_due_week] += amount;
    // 2. Subtract the payment amount from the new, delayed week
    simulatedFlow[newDueWeek] -= amount;
    return simulatedFlow;
}
