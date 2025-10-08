// packages/api/src/services/forecasting.service.ts
import db from '../db';
import { InventoryItem } from '../types';
import axios from 'axios'; // Import axios

// The URL of our running AI microservice
const AI_ENGINE_URL = 'http://127.0.0.1:8000';

export async function calculateTotalInventoryValue(): Promise<number> {
  const allInventory: InventoryItem[] = await db('inventory_truth').select('price', 'quantity_available');
  const totalValue = allInventory.reduce((total: number, item: InventoryItem) => {
    const price = parseFloat(item.price);
    return total + (item.quantity_available * price);
  }, 0);
  return totalValue;
}

// --- NEW FUNCTION ---
export async function getDemandForecastForSku(sku: string): Promise<any> {
  try {
    // 1. Fetch historical sales data for the given SKU from our database.
    // For now, we'll simulate this with a hardcoded array.
    // In the future, we would query the 'orders' or 'financial_transactions' table.
    // 1. Fetch REAL historical sales data for the given SKU from the database.
    const salesRecords = await db('historical_sales')
      .where({ sku: sku })
      .orderBy('sale_date', 'asc');

    if (salesRecords.length < 2) {
      throw new Error('Not enough historical data to generate a forecast.');
    }

    // 2. Extract just the quantity_sold into a simple array.
    const historical_sales = salesRecords.map((record: { quantity_sold: number }) => record.quantity_sold);

    // 3. Make an API call to our Python AI Engine with the live data.
    const response = await axios.post(`${AI_ENGINE_URL}/predict/demand`, {
      sku: sku,
      historical_sales: historical_sales
    });

    // 4. Return the forecast.
    return response.data;

  } catch (error) {
    console.error("Error fetching forecast from AI engine:", error);
    throw new Error('Failed to retrieve demand forecast.');
  }
}