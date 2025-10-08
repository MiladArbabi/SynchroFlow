// packages/api/src/server.ts
import express from 'express';
import db from './db';
import { getDemandForecastForSku } from './services/forecasting.service';

// --- ADD THESE LINES ---
// Use 'path' to create a reliable, absolute path to the addon file
import path from 'path';

// Load the C++ addon. The path goes up from /api, then down into /cpp-core.
const addonPath = path.join(__dirname, '../../../packages/cpp-core/build/Release/sf_core.node');
const addon = require(addonPath);

const app = express();
app.use(express.json());
const port = 3000;

// --- Routes ---
app.get('/', (req, res) => {
  res.send('SynchroFlow API is running!');
});

app.get('/v1/inventory/:sku', (req, res) => {
  const { sku } = req.params;
  // Get countryCode from query params, e.g., ?countryCode=DE
  // Default to a null value if not provided
  const countryCode = req.query.countryCode as string || null;

  try {
    // Call the C++ function with the data from the API request
    const inventoryData = addon.getInventoryItem(sku, countryCode);
    res.json(inventoryData);
  } catch (error) {
    // If the C++ addon throws an error, catch it and send a server error response
    if(error instanceof Error){
        res.status(500).json({ error: error.message });
    } else {
        res.status(500).json({ error: 'An unknown error occurred' });
    }
  }
});

app.get('/v1/inventory', async (req, res) => {
  try {
    const inventory = await db('inventory_truth').select('*');
    res.json(inventory);
  } catch (error) {
    console.error(error); // Log the error for debugging
    if (error instanceof Error) {
      res.status(500).json({ error: error.message });
    } else {
      res.status(500).json({ error: 'An unknown database error occurred' });
    }
  }
});

app.get('/v1/forecast/demand/:sku', async (req, res) => {
  try {
    const { sku } = req.params;
    const forecast = await getDemandForecastForSku(sku);
    res.json(forecast);
  } catch (error) {
    if (error instanceof Error) {
      res.status(500).json({ error: error.message });
    } else {
      res.status(500).json({ error: 'An unknown error occurred while generating forecast.' });
    }
  }
});

app.post('/v1/inventory', async (req, res) => {
  try {
    // Separate the incoming 'quantity' from the rest of the request body
    const { quantity, ...restOfBody } = req.body;

    // Create a new object that maps 'quantity' to 'quantity_available'
    const newItemForDb = {
      ...restOfBody,
      quantity_available: quantity || 0, // Use the provided quantity or default to 0
      quantity_reserved: 0,
      quantity_buffer: 0
    };

    const [createdItem] = await db('inventory_truth').insert(newItemForDb).returning('*');
    
    res.status(201).json(createdItem);
  } catch (error) {
   console.error(error);
    if (error instanceof Error) {
      res.status(500).json({ error: error.message });
    } else {
      res.status(500).json({ error: 'An unknown database error occurred' });
    }
  }
});

app.post('/v1/shops', async (req, res) => {
  try {
    const newShop = req.body;
    const [createdShop] = await db('shops').insert(newShop).returning('*');
    res.status(201).json(createdShop);
  } catch (error) {
    console.error(error);
    if (error instanceof Error) {
      res.status(500).json({ error: error.message });
    } else {
      res.status(500).json({ error: 'An unknown database error occurred' });
    }
  }
});

app.post('/v1/data/sales', async (req, res) => {
  try {
    const salesData = req.body;

    // Basic validation to ensure we have the required data
    if (!salesData.shop_id || !salesData.sku || !salesData.sale_date || !salesData.quantity_sold) {
      return res.status(400).json({ error: 'shop_id, sku, sale_date, and quantity_sold are required.' });
    }

    const [loggedSale] = await db('historical_sales').insert(salesData).returning('*');
    res.status(201).json(loggedSale);
  } catch (error) {
    console.error(error);
    if (error instanceof Error) {
      res.status(500).json({ error: error.message });
    } else {
      res.status(500).json({ error: 'An unknown database error occurred' });
    }
  }
});

app.post('/v1/data/product-costs', async (req, res) => {
  try {
    const costData = req.body;

    if (!costData.sku || !costData.purchase_price || !costData.landed_cost_per_unit) {
      return res.status(400).json({ error: 'sku, purchase_price, and landed_cost_per_unit are required.' });
    }

    const [loggedCost] = await db('product_costs').insert(costData).returning('*');
    res.status(201).json(loggedCost);
  } catch (error) {
    console.error(error);
    if (error instanceof Error) {
      res.status(500).json({ error: error.message });
    } else {
      res.status(500).json({ error: 'An unknown database error occurred' });
    }
  }
});

app.post('/v1/transactions', async (req, res) => {
  try {
    const transactionData = req.body;
    const [loggedTransaction] = await db('financial_transactions').insert(transactionData).returning('*');
    res.status(201).json(loggedTransaction);
  } catch (error) {
    console.error(error);
    if (error instanceof Error) {
      res.status(500).json({ error: error.message });
    } else {
      res.status(500).json({ error: 'An unknown database error occurred' });
    }
  }
});

app.put('/v1/inventory/:sku', async (req, res) => {
  try {
    const { sku } = req.params;
    const { quantity_available } = req.body;

    const updatedCount = await db('inventory_truth')
      .where({ sku: sku })
      .update({
        quantity_available: quantity_available,
      });

    if (updatedCount === 0) {
      return res.status(404).json({ error: 'SKU not found' });
    }

    const [updatedItem] = await db('inventory_truth').where({ sku: sku }).select('*');
    res.json(updatedItem);
  } catch (error) {
    console.error(error);
    if (error instanceof Error) {
      res.status(500).json({ error: error.message });
    } else {
      res.status(500).json({ error: 'An unknown database error occurred' });
    }
  }
});

if (require.main === module) {
  app.listen(port, () => {
    console.log(`Server is listening on port ${port}`);
  });
}

export default app;