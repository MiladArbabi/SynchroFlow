"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.processMessage = processMessage;
exports.startWorker = startWorker;
const queue_1 = require("./queue");
const db_1 = __importDefault(require("./db"));
const transformer_1 = require("./transformer");
// Get the specific channel for 'events'
const eventChannel = (0, queue_1.getQueueChannel)('events');
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
            eventChannel.ack(msg); // Acknowledge message to remove from queue
            return;
        }
        // Fetch the raw payload from the database
        const stagedEvent = await (0, db_1.default)('staged_events')
            .where({ id: staged_event_id })
            .first();
        if (!stagedEvent) {
            console.error(`[worker] Staged event with id ${staged_event_id} not found.`);
            eventChannel.ack(msg);
            return;
        }
        // Fetch the mapping rules for the shop associated with the event
        const mappingRules = await (0, db_1.default)('data_mapping_rules')
            .where({ shop_id: stagedEvent.shop_id });
        // Transform the payload
        const transformedPayload = (0, transformer_1.transformPayload)(stagedEvent.raw_payload, mappingRules);
        console.log('[worker] Successfully transformed payload:', transformedPayload);
        // Acknowledge the message was processed successfully
        eventChannel.ack(msg);
    }
    catch (error) {
        console.error('[worker] Error processing message:', error);
        // In case of error, we "nack" the message (negative acknowledgement)
        // and tell the queue not to re-queue it to avoid infinite loops.
        eventChannel.nack(msg, false, false);
    }
}
// This function starts the consumer
function startWorker() {
    console.log('[worker] Starting API worker...');
    eventChannel.consume('events', processMessage, { noAck: false });
    console.log('[worker] Worker started. Waiting for events...');
}
