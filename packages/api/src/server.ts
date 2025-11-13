// packages/api/src/server.ts
import dotenv from 'dotenv';
dotenv.config();
import cookieParser from 'cookie-parser';
import express from 'express';
import session from 'express-session';
import db from './db';
import userStateRoutes from './api/user-state/user-state.routes';

import { federatedSearch } from './services/koreSearch';
import { opsIntelEmitter } from './services/opsIntel/emitter';
import connectPgSimple from 'connect-pg-simple';
import { 
  getDemandForecastForSku, 
  calculateTotalInventoryValue,
  simulatePaymentDelay } from './services/forecasting.service';
import { 
  calculateGrossRevenue, 
  calculateGrossMargin,
  getInventoryHealth,
  calculateCostOfStockout,
  getFulfillmentPipeline,
  calculatePerfectOrderPercentage } from './services/analytics.service';
import { startWorker } from './worker';
import { startSyncWorker } from './sync.worker';
import { seedSandboxData } from './db/seeder';
import layoutRoutes from "./api/layouts/layout.routes";
import orderRoutes from "./api/orders/orders.routes";
import customerRoutes from "./api/customers/customers.routes";
import integrationRoutes from "./api/integrations/integration.routes";
import authRoutes from "./api/auth/auth.routes";
import dashboardRoutes from "./api/dashboard/dashboard.routes";

// OPS-INTEL Imports
import opsIntelRoutes from "./api/ops-intel/ops-intel.routes";
import { OpsIntelEngine } from './services/opsIntel';
import { staleOrderRule } from './services/opsIntel/rules';

// Use 'path' to create a reliable, absolute path to the addon file
import path from 'path';

// Load the C++ addon. The path is different for tests (running from src) vs. dev (running from dist).
const addonPath = process.env.NODE_ENV === 'test'
  ? path.join(__dirname, '../../../packages/core-engine/build/Release/sf_core.node') // Path for Jest/ts-jest
  : path.join(__dirname, './sf_core.node'); // Path for the compiled server.js
const addon = require(addonPath);

const app = express();
app.use(express.json());
app.use(cookieParser());

// --- TO FIX FLY DEPLOY ---
const PGStore = connectPgSimple(session);
const sessionStore = new PGStore({
  conObject: db.client.config.connection, // <-- Give it the connection object
  tableName: 'user_sessions',
});

// --- 3. INITIALIZE AND START THE KORE ENGINE ---
const koreEngine = new OpsIntelEngine();

// Register all our business rules
koreEngine.registerRule(staleOrderRule);
// koreEngine.registerRule(lowInventoryRule);

// Start the engine's cron jobs
koreEngine.start();

// --- SESSION MIDDLEWARE ---
app.use(
  session({
    store: sessionStore, // <-- USE THE NEW PGStore
    secret: process.env.SESSION_SECRET || 'fallback-secret-please-set-in-prod',
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: process.env.NODE_ENV === 'production',
      httpOnly: true,
      maxAge: 1000 * 60 * 60 * 24 * 7, // 1 week
    },
  })
);

const port = Number(process.env.PORT) || 8080; 

// Integrate the new layout routes
app.use("/api/v1/layouts", layoutRoutes);
app.use("/api/v1/ops-intel", opsIntelRoutes);
app.use("/api/v1/orders", orderRoutes);
app.use("/api/v1/customers", customerRoutes);
app.use("/api/v1/integrations", integrationRoutes);
app.use("/api/v1/auth", authRoutes);
app.use("/api/v1/dashboard", dashboardRoutes);
app.use("/api/v1/user-state", userStateRoutes);

// --- Routes ---
app.get('/', (req, res) => {
  res.send('SynchroFlow API is running!');
});

// --- THE DUMB HEALTH CHECK ---
// This stops the app from crashing on the health check.
app.get('/health', (req, res) => {
  console.log('THE DUMB HEALTH CHECK IN API/SERVER');
  res.status(200).send({ status: 'ok' });
});

app.get('/api/v1/kore/search', async (req, res) => {
  const query = req.query.q as string;

  if (!query) {
    return res.status(400).json({ error: 'Missing query parameter "q"' });
  }

  // Call our new search service
  const results = await federatedSearch(query);
  res.status(200).json(results);
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

app.get('/v1/analytics/inventory-value', async (req, res) => {
  try {
    const totalValue = await calculateTotalInventoryValue();
    res.json({ total_inventory_value: totalValue });
  } catch (error) {
    console.error(error);
    if (error instanceof Error) {
      res.status(500).json({ error: error.message });
    } else {
      res.status(500).json({ error: 'An unknown error occurred while calculating inventory value.' });
    }
  }
});

app.get('/api/v1/mappings', async (req, res) => {
  try {
    const { shop_id } = req.query;

    if (!shop_id) {
      return res.status(400).json({ error: 'shop_id query parameter is required.' });
    }

    const rules = await db('data_mapping_rules').where({ shop_id: Number(shop_id) });

    res.status(200).json(rules);
  } catch (error) {
    console.error(error);
    if (error instanceof Error) {
      res.status(500).json({ error: error.message });
    } else {
      res.status(500).json({ error: 'An unknown database error occurred' });
    }
  }
});

// --- SSE ENDPOINT ---
app.get('/api/v1/kore/subscribe', (req, res) => {
  // Set headers for Server-Sent Events
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders(); // Send headers immediately

  // The handler function that sends data to the client
  const sendInsight = (insight: any) => {
    res.write(`event: insight\n`);
    res.write(`data: ${JSON.stringify(insight)}\n\n`);
  };

  // Add this client to the emitter's listener pool
  opsIntelEmitter.on('insight', sendInsight);

  // Send a simple "connected" message
  res.write('data: {"type":"connection_established"}\n\n');

  // Remove the listener when the client disconnects
  req.on('close', () => {
    opsIntelEmitter.off('insight', sendInsight);
    res.end();
  });
});

// --- KORE HEALTH CHECK ---
app.get('/api/v1/kore/health', async (req, res) => {
  try {
    // 1. Check database connection
    await db.raw('SELECT 11 AS result');

    // 2. Add more checks later (e.g., SSE emitter health)
    
    res.status(200).json({
      status: 'healthy',
      services: {
        database: 'connected',
      },
    });
  } catch (error: any) {
    console.error('[Kore Health] Health check failed:', error.message);
    res.status(503).json({ status: 'unhealthy', services: { database: 'disconnected' } });
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

app.post('/v1/simulations/payment-delay', (req, res) => {
  try {
    const { current_cash_flow, payment_details } = req.body;

    if (!current_cash_flow || !payment_details) {
      return res.status(400).json({ error: 'Missing required simulation data.' });
    }

    const simulated_cash_flow = simulatePaymentDelay(current_cash_flow, payment_details);
    res.json({ simulated_cash_flow });

  } catch (error) {
    // This will catch errors from the service, like an out-of-bounds delay
    const message = error instanceof Error ? error.message : 'An unknown error occurred during simulation.';
    res.status(400).json({ error: message });
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

app.post('/api/v1/mappings', async (req, res) => {
  try {
    const newRule = req.body;

    // Basic validation
    if (!newRule.shop_id || !newRule.source_platform || !newRule.source_field_path || !newRule.target_field_path) {
      return res.status(400).json({ error: 'Missing required fields for mapping rule.' });
    }

    const [createdRule] = await db('data_mapping_rules').insert(newRule).returning('*');
    res.status(201).json(createdRule);
  } catch (error) {
    console.error(error);
    if (error instanceof Error) {
      res.status(500).json({ error: error.message });
    } else {
      res.status(500).json({ error: 'An unknown database error occurred' });
    }
  }
});

app.delete('/api/v1/mappings/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const deletedCount = await db('data_mapping_rules').where({ id: Number(id) }).del();

    if (deletedCount === 0) {
      return res.status(404).json({ error: 'Mapping rule not found.' });
    }

    res.status(204).send(); // 204 No Content is standard for a successful delete
  } catch (error) {
    console.error(error);
    if (error instanceof Error) {
      res.status(500).json({ error: error.message });
    } else {
      res.status(500).json({ error: 'An unknown database error occurred' });
    }
  }
});

// --- ANALYTICS ENDPOINTS ---
app.get('/v1/analytics/gross-revenue', async (req, res) => {
  try {
    const shopId = Number(req.query.shop_id);
    if (isNaN(shopId)) {
      return res.status(400).json({ error: 'A valid shop_id is required.' });
    }

    const revenue = await calculateGrossRevenue(shopId);
    res.json({ gross_revenue: revenue });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to calculate gross revenue.' });
  }
});

app.get('/v1/analytics/gross-margin', async (req, res) => {
  try {
    const shopId = Number(req.query.shop_id);
    if (isNaN(shopId)) {
      return res.status(400).json({ error: 'A valid shop_id is required.' });
    }
    const margin = await calculateGrossMargin(shopId);
    res.json({ gross_margin_percentage: margin });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to calculate gross margin.' });
  }
});

app.get('/v1/analytics/inventory-health', async (req, res) => {
  try {
    const shopId = Number(req.query.shop_id);
    if (isNaN(shopId)) {
      return res.status(400).json({ error: 'A valid shop_id is required.' });
    }
    const healthData = await getInventoryHealth(shopId);
    res.json(healthData);
  } catch (error) {
    console.error('Error fetching inventory health:', error);
    res.status(500).json({ error: 'Failed to fetch inventory health data.' });
  }
});

app.get('/v1/analytics/cost-of-stockout', async (req, res) => {
  try {
    const shopId = Number(req.query.shop_id);
    const sku = req.query.sku as string;

    if (isNaN(shopId) || !sku) {
      return res.status(400).json({ error: 'A valid shop_id and sku are required.' });
    }

    const cost = await calculateCostOfStockout(shopId, sku);
    res.json({ cost_of_stockout: cost });
  } catch (error) {
    console.error('Error calculating cost of stockout:', error);
    res.status(500).json({ error: 'Failed to calculate cost of stockout.' });
  }
});

app.get('/v1/analytics/fulfillment-pipeline', async (req, res) => {
  try {
    const shopId = Number(req.query.shop_id);
    if (isNaN(shopId)) {
      return res.status(400).json({ error: 'A valid shop_id is required.' });
    }

    const pipelineData = await getFulfillmentPipeline(shopId);
    res.json(pipelineData);
  } catch (error) {
    console.error('Error fetching fulfillment pipeline:', error);
    res.status(500).json({ error: 'Failed to fetch fulfillment pipeline data.' });
  }
});

app.get('/v1/analytics/perfect-order-percentage', async (req, res) => {
  try {
    const shopId = Number(req.query.shop_id);
    if (isNaN(shopId)) {
      return res.status(400).json({ error: 'A valid shop_id is required.' });
    }

    const percentage = await calculatePerfectOrderPercentage(shopId);
    res.json({ perfect_order_percentage: percentage });
  } catch (error) {
    console.error('Error calculating perfect order percentage:', error);
    res.status(500).json({ error: 'Failed to calculate perfect order percentage.' });
  }
});

// --- DEVELOPMENT ONLY ENDPOINTS ---
// This endpoint should be protected or removed in production
app.post('/api/v1/dev/seed-sandbox/:shop_id', async (req, res) => {
  try {
    const shopId = Number(req.params.shop_id);
    if (isNaN(shopId)) {
      return res.status(400).json({ error: 'A valid shop_id is required.' });
    }

    await seedSandboxData(shopId);

    res.status(200).json({ message: `Sandbox data seeded for shopId: ${shopId}` });
  } catch (error) {
    console.error('[seeder-endpoint] Error seeding sandbox data:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: `Failed to seed sandbox data: ${message}` });
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

app.put('/api/v1/mappings/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    const updatedCount = await db('data_mapping_rules').where({ id: Number(id) }).update(updates);

    if (updatedCount === 0) {
      return res.status(404).json({ error: 'Mapping rule not found.' });
    }

    const [updatedRule] = await db('data_mapping_rules').where({ id: Number(id) });
    res.status(200).json(updatedRule);
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
  app.listen(port, "0.0.0.0", () => {
    console.log(`Server is listening on port ${port}`);
    // console.log('[DEBUG] Workers are temporarily disabled for debugging.');

    try {
      // Start the queue worker
      startWorker();
    } catch (err: any) { // Added ': any' to fix the implicit 'any' error
      console.error('!!! FAILED TO START API WORKER !!!', err);
      process.exit(1); // Exit with an error
    }

    try {
      // Start the sync worker
      startSyncWorker();
    } catch (err: any) { // Added ': any' to fix the implicit 'any' error
      console.error('!!! FAILED TO START SYNC WORKER !!!', err);
      process.exit(1); // Exit with an error
    }
  });
}

export default app;