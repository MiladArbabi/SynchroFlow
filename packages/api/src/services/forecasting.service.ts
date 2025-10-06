// packages/api/src/services/forecasting.service.ts
import db from '../db';
import { InventoryItem } from '../types';
import axios from 'axios'; // Import axios

// The URL of our running AI microservice
const AI_ENGINE_URL = 'http://127.0.0.1:8000';

export async function calculateTotalInventoryValue(): Promise<number> {
  const allInventory: InventoryItem[] = await db('inventory_truth').select('*');
  const totalValue = allInventory.reduce((total, item) => {
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
    const historical_sales = [110, 130, 155, 142, 168, 180, 205]; // Sample data

    // 2. Make an API call to our Python AI Engine.
    const response = await axios.post(`${AI_ENGINE_URL}/predict/demand`, {
      sku: sku,
      historical_sales: historical_sales
    });

    // 3. Return the forecast from the AI Engine's response.
    return response.data;

  } catch (error) {
    console.error("Error fetching forecast from AI engine:", error);
    throw new Error('Failed to retrieve demand forecast.');
  }
}