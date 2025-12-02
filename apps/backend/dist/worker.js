"use strict";
// apps/backend/src/worker.ts
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.processMessage = processMessage;
exports.startWorker = startWorker;
const queue_1 = require("./queue");
const db_1 = __importDefault(require("./db"));
const transformer_1 = require("./transformer");
const canonical_commerce_ingestion_service_1 = require("api-src/services/canonical-commerce-ingestion.service");
const order_nexus_canonical_ingestion_service_1 = require("api-src/services/order-nexus-canonical-ingestion.service");
// Lazily obtain the specific channel for 'events' so tests can safely mock getQueueChannel
let eventChannel = null;
function getEventChannel() {
    if (!eventChannel) {
        eventChannel = (0, queue_1.getQueueChannel)('events');
    }
    return eventChannel;
}
// Lazily create service instances so test harness can mock the classes before instantiation
let canonicalIngestionService = null;
function getCanonicalIngestionService() {
    if (!canonicalIngestionService) {
        canonicalIngestionService = new canonical_commerce_ingestion_service_1.CanonicalCommerceIngestionService();
    }
    return canonicalIngestionService;
}
let orderNexusCanonicalIngestionService = null;
function getOrderNexusCanonicalIngestionService() {
    if (!orderNexusCanonicalIngestionService) {
        orderNexusCanonicalIngestionService = new order_nexus_canonical_ingestion_service_1.OrderNexusCanonicalIngestionService();
    }
    return orderNexusCanonicalIngestionService;
}
// This is the function our test is targeting
async function processMessage(msg) {
    if (msg === null) {
        return;
    }
    const content = msg.content.toString();
    try {
        const { staged_event_id } = JSON.parse(content);
        if (!staged_event_id) {
            console.error('[worker] Message is missing staged_event_id');
            getEventChannel().ack(msg);
            return;
        }
        // 1) Load staged event
        const stagedEvent = await (0, db_1.default)('staged_events')
            .where({ id: staged_event_id })
            .first();
        if (!stagedEvent) {
            console.error(`[worker] Staged event with id ${staged_event_id} not found.`);
            getEventChannel().ack(msg);
            return;
        }
        // 2) Legacy transform path (kept for now for other consumers)
        const mappingRules = await (0, db_1.default)('data_mapping_rules').where({
            shop_id: stagedEvent.shop_id,
        });
        const transformedPayload = (0, transformer_1.transformPayload)(stagedEvent.raw_payload, mappingRules);
        console.log('[worker] Successfully transformed payload:', transformedPayload);
        // 3) NEW: persist canonical order snapshot
        // For FT0 we assume raw_payload is already in CanonicalOrder shape
        // for Shopify order events. Other event types can be handled separately.
        try {
            await getCanonicalIngestionService().insertCanonicalOrder(stagedEvent.raw_payload);
        }
        catch (e) {
            console.error('[worker] Failed to persist canonical order from staged event:', e);
            // Decide policy: for now we still ack to avoid poison messages.
            // If you want strict ingestion semantics, switch this to nack.
        }
        // 3b) Enqueue canonical order into OrderNexus ingestion flow
        try {
            const canonicalOrder = stagedEvent.raw_payload;
            if (canonicalOrder && canonicalOrder.id && stagedEvent.shop_id) {
                await getOrderNexusCanonicalIngestionService().enqueueOrderForOrderNexus(stagedEvent.shop_id, canonicalOrder.id);
            }
        }
        catch (e) {
            console.error('[worker] Failed to enqueue canonical order for OrderNexus:', e);
            // Same policy: log but do not poison the queue for FT0.
        }
        // 4) Success path → ack
        getEventChannel().ack(msg);
    }
    catch (error) {
        console.error('[worker] Error processing message:', error);
        getEventChannel().nack(msg, false, false);
    }
}
// This function starts the consumer
function startWorker() {
    console.log('[worker] Starting API worker...');
    getEventChannel().consume('events', processMessage, { noAck: false });
    console.log('[worker] Worker started. Waiting for events...');
}
//# sourceMappingURL=worker.js.map