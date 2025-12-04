"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// apps/backend/src/server.ts
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
const cookie_parser_1 = __importDefault(require("cookie-parser"));
const express_1 = __importDefault(require("express"));
const express_session_1 = __importDefault(require("express-session"));
const db_1 = __importDefault(require("./db"));
const user_state_routes_1 = __importDefault(require("./api/user-state/user-state.routes"));
const shopify_routes_1 = __importDefault(require("./api/shopify/shopify.routes"));
const koreSearch_1 = require("./services/koreSearch");
const emitter_1 = require("./services/opsIntel/emitter");
const connect_pg_simple_1 = __importDefault(require("connect-pg-simple"));
const analytics_service_1 = require("./services/analytics.service");
/* import { startWorker } from './worker.js';
import { startSyncWorker } from './sync.worker.js'; */
const seeder_1 = require("./db/seeder");
const layout_routes_1 = __importDefault(require("./api/layouts/layout.routes"));
const orders_routes_1 = __importDefault(require("./api/orders/orders.routes"));
const customers_routes_1 = __importDefault(require("./api/customers/customers.routes"));
const integration_routes_1 = __importDefault(require("./api/integrations/integration.routes"));
const products_routes_1 = __importDefault(require("./api/products/products.routes"));
const auth_routes_1 = __importDefault(require("./api/auth/auth.routes"));
const dashboard_routes_1 = __importDefault(require("./api/dashboard/dashboard.routes"));
const product_costs_routes_1 = __importDefault(require("./api/product-costs/product-costs.routes"));
const entitlements_controller_1 = require("./api/entitlements/entitlements.controller");
// OPS-INTEL Imports
const ops_intel_routes_1 = __importDefault(require("./api/ops-intel/ops-intel.routes"));
const opsIntel_1 = require("./services/opsIntel");
const rules_1 = require("./services/opsIntel/rules");
const app = (0, express_1.default)();
app.use(express_1.default.json());
app.use((0, cookie_parser_1.default)());
// --- TO FIX FLY DEPLOY ---
const PGStore = (0, connect_pg_simple_1.default)(express_session_1.default);
const sessionStore = new PGStore({
    conObject: db_1.default.client.config.connection, // <-- Give it the connection object
    tableName: 'user_sessions',
});
// --- 3. INITIALIZE AND START THE KORE ENGINE ---
const koreEngine = new opsIntel_1.OpsIntelEngine();
// Register all our business rules
koreEngine.registerRule(rules_1.staleOrderRule);
// koreEngine.registerRule(lowInventoryRule);
// Start the engine's cron jobs
koreEngine.start();
// --- SESSION MIDDLEWARE ---
app.use((0, express_session_1.default)({
    store: sessionStore, // <-- USE THE NEW PGStore
    secret: process.env.SESSION_SECRET || 'fallback-secret-please-set-in-prod',
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: process.env.NODE_ENV === 'production',
        httpOnly: true,
        maxAge: 1000 * 60 * 60 * 24 * 7, // 1 week
    },
}));
// Use 3000 as the dev default so UI (vite) proxy and dev scripts match.
const port = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '127.0.0.1';
// [REMOVED early listen - use require.main block below]
// Integrate the new layout routes
app.use("/api/v1/layouts", layout_routes_1.default);
app.use("/api/v1/ops-intel", ops_intel_routes_1.default);
app.use("/api/v1/orders", orders_routes_1.default);
app.use("/api/v1/customers", customers_routes_1.default);
app.use("/api/v1/integrations", integration_routes_1.default);
app.use("/api/v1/products", products_routes_1.default);
app.use("/api/v1/product-costs", product_costs_routes_1.default);
app.use("/api/v1/auth", auth_routes_1.default);
app.use("/api/v1/dashboard", dashboard_routes_1.default);
app.use("/api/v1/user-state", user_state_routes_1.default);
app.use("/api/v1/shopify", shopify_routes_1.default);
app.get('/api/v1/entitlements/me', entitlements_controller_1.getMyEntitlements);
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
    const query = req.query.q;
    if (!query) {
        return res.status(400).json({ error: 'Missing query parameter "q"' });
    }
    // Call our new search service
    const results = await (0, koreSearch_1.federatedSearch)(query);
    res.status(200).json(results);
});
app.get('/v1/inventory/:sku', async (req, res) => {
    const { sku } = req.params;
    const countryCode = req.query.countryCode || null;
    try {
        let query = (0, db_1.default)('inventory_truth').where({ sku });
        if (countryCode) {
            query = query.andWhere({ country_code: countryCode });
        }
        const inventoryData = await query.first();
        if (!inventoryData) {
            return res.status(404).json({ error: 'SKU not found' });
        }
        res.json(inventoryData);
    }
    catch (error) {
        console.error('Error fetching inventory:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
app.get('/v1/inventory', async (req, res) => {
    try {
        const inventory = await (0, db_1.default)('inventory_truth').select('*');
        res.json(inventory);
    }
    catch (error) {
        console.error(error); // Log the error for debugging
        if (error instanceof Error) {
            res.status(500).json({ error: error.message });
        }
        else {
            res.status(500).json({ error: 'An unknown database error occurred' });
        }
    }
});
app.get('/api/v1/mappings', async (req, res) => {
    try {
        const { shop_id } = req.query;
        if (!shop_id) {
            return res.status(400).json({ error: 'shop_id query parameter is required.' });
        }
        const rules = await (0, db_1.default)('data_mapping_rules').where({ shop_id: Number(shop_id) });
        res.status(200).json(rules);
    }
    catch (error) {
        console.error(error);
        if (error instanceof Error) {
            res.status(500).json({ error: error.message });
        }
        else {
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
    const sendInsight = (insight) => {
        res.write(`event: insight\n`);
        res.write(`data: ${JSON.stringify(insight)}\n\n`);
    };
    // Add this client to the emitter's listener pool
    emitter_1.opsIntelEmitter.on('insight', sendInsight);
    // Send a simple "connected" message
    res.write('data: {"type":"connection_established"}\n\n');
    // Remove the listener when the client disconnects
    req.on('close', () => {
        emitter_1.opsIntelEmitter.off('insight', sendInsight);
        res.end();
    });
});
// --- KORE HEALTH CHECK ---
app.get('/api/v1/kore/health', async (req, res) => {
    try {
        // 1. Check database connection
        await db_1.default.raw('SELECT 11 AS result');
        // 2. Add more checks later (e.g., SSE emitter health)
        res.status(200).json({
            status: 'healthy',
            services: {
                database: 'connected',
            },
        });
    }
    catch (error) {
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
        const [createdItem] = await (0, db_1.default)('inventory_truth').insert(newItemForDb).returning('*');
        res.status(201).json(createdItem);
    }
    catch (error) {
        console.error(error);
        if (error instanceof Error) {
            res.status(500).json({ error: error.message });
        }
        else {
            res.status(500).json({ error: 'An unknown database error occurred' });
        }
    }
});
app.post('/v1/shops', async (req, res) => {
    try {
        const newShop = req.body;
        const [createdShop] = await (0, db_1.default)('shops').insert(newShop).returning('*');
        res.status(201).json(createdShop);
    }
    catch (error) {
        console.error(error);
        if (error instanceof Error) {
            res.status(500).json({ error: error.message });
        }
        else {
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
        const [loggedSale] = await (0, db_1.default)('historical_sales').insert(salesData).returning('*');
        res.status(201).json(loggedSale);
    }
    catch (error) {
        console.error(error);
        if (error instanceof Error) {
            res.status(500).json({ error: error.message });
        }
        else {
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
        const [loggedCost] = await (0, db_1.default)('product_costs').insert(costData).returning('*');
        res.status(201).json(loggedCost);
    }
    catch (error) {
        console.error(error);
        if (error instanceof Error) {
            res.status(500).json({ error: error.message });
        }
        else {
            res.status(500).json({ error: 'An unknown database error occurred' });
        }
    }
});
app.post('/v1/transactions', async (req, res) => {
    try {
        const transactionData = req.body;
        const [loggedTransaction] = await (0, db_1.default)('financial_transactions').insert(transactionData).returning('*');
        res.status(201).json(loggedTransaction);
    }
    catch (error) {
        console.error(error);
        if (error instanceof Error) {
            res.status(500).json({ error: error.message });
        }
        else {
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
        const [createdRule] = await (0, db_1.default)('data_mapping_rules').insert(newRule).returning('*');
        res.status(201).json(createdRule);
    }
    catch (error) {
        console.error(error);
        if (error instanceof Error) {
            res.status(500).json({ error: error.message });
        }
        else {
            res.status(500).json({ error: 'An unknown database error occurred' });
        }
    }
});
app.delete('/api/v1/mappings/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const deletedCount = await (0, db_1.default)('data_mapping_rules').where({ id: Number(id) }).del();
        if (deletedCount === 0) {
            return res.status(404).json({ error: 'Mapping rule not found.' });
        }
        res.status(204).send(); // 204 No Content is standard for a successful delete
    }
    catch (error) {
        console.error(error);
        if (error instanceof Error) {
            res.status(500).json({ error: error.message });
        }
        else {
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
        const revenue = await (0, analytics_service_1.calculateGrossRevenue)(shopId);
        res.json({ gross_revenue: revenue });
    }
    catch (error) {
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
        const margin = await (0, analytics_service_1.calculateGrossMargin)(shopId);
        res.json({ gross_margin_percentage: margin });
    }
    catch (error) {
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
        const healthData = await (0, analytics_service_1.getInventoryHealth)(shopId);
        res.json(healthData);
    }
    catch (error) {
        console.error('Error fetching inventory health:', error);
        res.status(500).json({ error: 'Failed to fetch inventory health data.' });
    }
});
app.get('/v1/analytics/cost-of-stockout', async (req, res) => {
    try {
        const shopId = Number(req.query.shop_id);
        const sku = req.query.sku;
        if (isNaN(shopId) || !sku) {
            return res.status(400).json({ error: 'A valid shop_id and sku are required.' });
        }
        const cost = await (0, analytics_service_1.calculateCostOfStockout)(shopId, sku);
        res.json({ cost_of_stockout: cost });
    }
    catch (error) {
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
        const pipelineData = await (0, analytics_service_1.getFulfillmentPipeline)(shopId);
        res.json(pipelineData);
    }
    catch (error) {
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
        const percentage = await (0, analytics_service_1.calculatePerfectOrderPercentage)(shopId);
        res.json({ perfect_order_percentage: percentage });
    }
    catch (error) {
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
        await (0, seeder_1.seedSandboxData)(shopId);
        res.status(200).json({ message: `Sandbox data seeded for shopId: ${shopId}` });
    }
    catch (error) {
        console.error('[seeder-endpoint] Error seeding sandbox data:', error);
        const message = error instanceof Error ? error.message : 'Unknown error';
        res.status(500).json({ error: `Failed to seed sandbox data: ${message}` });
    }
});
app.put('/v1/inventory/:sku', async (req, res) => {
    try {
        const { sku } = req.params;
        const { quantity_available } = req.body;
        const updatedCount = await (0, db_1.default)('inventory_truth')
            .where({ sku: sku })
            .update({
            quantity_available: quantity_available,
        });
        if (updatedCount === 0) {
            return res.status(404).json({ error: 'SKU not found' });
        }
        const [updatedItem] = await (0, db_1.default)('inventory_truth').where({ sku: sku }).select('*');
        res.json(updatedItem);
    }
    catch (error) {
        console.error(error);
        if (error instanceof Error) {
            res.status(500).json({ error: error.message });
        }
        else {
            res.status(500).json({ error: 'An unknown database error occurred' });
        }
    }
});
app.put('/api/v1/mappings/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const updates = req.body;
        const updatedCount = await (0, db_1.default)('data_mapping_rules').where({ id: Number(id) }).update(updates);
        if (updatedCount === 0) {
            return res.status(404).json({ error: 'Mapping rule not found.' });
        }
        const [updatedRule] = await (0, db_1.default)('data_mapping_rules').where({ id: Number(id) });
        res.status(200).json(updatedRule);
    }
    catch (error) {
        console.error(error);
        if (error instanceof Error) {
            res.status(500).json({ error: error.message });
        }
        else {
            res.status(500).json({ error: 'An unknown database error occurred' });
        }
    }
});
if (require.main === module) {
    app.listen(port, "0.0.0.0", async () => {
        console.log(`Server is listening on port ${port}`);
        // Start queue worker (lazy import) — fail safely in dev if it can't be resolved
        try {
            const { startWorker } = await Promise.resolve().then(() => __importStar(require('./worker')));
            await startWorker();
        }
        catch (err) {
            console.error('!!! FAILED TO START API WORKER (lazy import) !!!', err && err.message ? err.message : err);
            // don't exit — keep server running for UI/dev work
        }
        // Start sync worker (lazy import)
        try {
            const { startSyncWorker } = await Promise.resolve().then(() => __importStar(require('./sync.worker')));
            await startSyncWorker();
        }
        catch (err) {
            console.error('!!! FAILED TO START SYNC WORKER (lazy import) !!!', err && err.message ? err.message : err);
            // don't exit
        }
    });
}
exports.default = app;
//# sourceMappingURL=server.js.map