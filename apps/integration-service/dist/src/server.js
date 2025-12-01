"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// packages/integration-service/src/server.ts
const express_1 = __importDefault(require("express"));
const crypto_1 = __importDefault(require("crypto"));
const db_1 = __importDefault(require("./db"));
const queue_1 = require("./queue");
const shopify_1 = require("./clients/shopify");
const app = (0, express_1.default)();
const port = process.env.INTEGRATION_PORT || 3001;
// --- Shopify HMAC Verification Middleware ---
// IMPORTANT: This middleware needs to run BEFORE express.json() for the webhook route,
// because it needs the raw, unparsed request body to compute the signature.
const verifyShopifyWebhook = (req, res, next) => {
    const hmacHeader = req.get('X-Shopify-Hmac-Sha256');
    // Use the rawBody we save from the verify function, not the parsed body
    const body = req.rawBody;
    const secret = process.env.SHOPIFY_WEBHOOK_SECRET?.trim();
    if (!hmacHeader || !secret) {
        return res.status(401).send('Unauthorized: Missing signature or secret.');
    }
    try {
        const generatedHash = crypto_1.default
            .createHmac('sha256', secret)
            .update(body)
            .digest('base64');
        const trusted = Buffer.from(hmacHeader, 'base64');
        const untrusted = Buffer.from(generatedHash, 'base64');
        if (crypto_1.default.timingSafeEqual(trusted, untrusted)) {
            next(); // Signature is valid
        }
        else {
            // Signatures don't match
            res.status(401).send('Unauthorized: Invalid signature.');
        }
    }
    catch (error) {
        // Catch any errors during comparison (e.g., invalid Base64 format)
        res.status(401).send('Unauthorized: Invalid signature format.');
    }
};
app.get('/health', (req, res) => {
    //console.log('[DEBUG] Health check hit. Responding OK.');
    res.status(200).send({ status: 'ok' });
});
// --- Webhook Ingestion Route ---
app.post('/ingest/shopify/:shop_id/orders/create', 
// Use express.json with a custom verify function
express_1.default.json({
    verify: (req, res, buf) => {
        // Save the raw buffer to the request object before it's parsed
        req.rawBody = buf;
    }
}), verifyShopifyWebhook, async (req, res) => {
    // The signature is valid, and the body is already parsed JSON.
    const payload = req.body;
    const { shop_id } = req.params;
    try {
        // Save the raw payload to our staging table
        const [stagedEvent] = await (0, db_1.default)('staged_events').insert({
            shop_id: Number(shop_id),
            source_platform: 'shopify',
            event_type: 'orders/create',
            raw_payload: payload,
        }).returning('id');
        // Publish the ID of the staged event to the queue
        await (0, queue_1.publishToQueue)('events', JSON.stringify({ staged_event_id: stagedEvent.id }));
        console.log('Received and verified Shopify webhook for order:', payload.order_id);
        res.status(200).send('Webhook received');
    }
    catch (error) {
        console.error('Error processing webhook:', error);
        res.status(500).send('Error processing webhook');
    }
});
// --- Integration Triggers ---
app.post('/integrations/shopify/start-trial-sync', express_1.default.json(), async (req, res) => {
    try {
        const { shopId, shop, accessToken } = req.body;
        if (!shopId || !shop || !accessToken) {
            return res.status(400).json({ error: 'shopId, shop, and accessToken are required.' });
        }
        // 1. Fetch the recent orders from Shopify
        const orders = await (0, shopify_1.fetchRecentOrders)(shop, accessToken);
        // 2. Process each order by pushing it into our pipeline
        for (const order of orders) {
            // Save the raw payload to our staging table
            const [stagedEvent] = await (0, db_1.default)('staged_events').insert({
                shop_id: shopId,
                source_platform: 'shopify',
                event_type: 'orders/create', // We treat each synced order as a 'create' event
                raw_payload: order,
            }).returning('id');
            // Publish the ID of the staged event to the queue
            await (0, queue_1.publishToQueue)('events', JSON.stringify({ staged_event_id: stagedEvent.id }));
        }
        console.log(`[trial-sync] Initiated sync for ${orders.length} orders for shop ${shopId}.`);
        // 202 Accepted is a great status code for starting a background job.
        res.status(202).json({ message: `Scoped trial sync initiated for ${orders.length} orders.` });
    }
    catch (error) {
        console.error('Error starting scoped trial sync:', error);
        res.status(500).json({ error: 'Failed to start trial sync.' });
    }
});
// This conditional allows us to import 'app' in our tests without starting the server.
if (process.env.NODE_ENV !== 'test') {
    app.listen(port, () => {
        console.log(`[integration-service]: Server is running at http://localhost:${port}`);
    });
}
exports.default = app; // Export the app for testing
