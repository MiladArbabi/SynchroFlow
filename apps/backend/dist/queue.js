"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getQueueChannel = exports.connection = void 0;
// packages/api/src/queue.ts
const amqp_connection_manager_1 = __importDefault(require("amqp-connection-manager"));
const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://guest:guest@localhost:5672';
// 1. Add heartbeat to keep connection alive and detect drops faster
exports.connection = amqp_connection_manager_1.default.connect([RABBITMQ_URL], {
    heartbeatIntervalInSeconds: 5,
    reconnectTimeInSeconds: 5,
});
exports.connection.on('connect', () => console.log('[api/queue.ts] Connected to RabbitMQ'));
exports.connection.on('disconnect', (e) => {
    // Use console.error so it stands out in logs
    console.error('[api/queue.ts] Disconnected from RabbitMQ:', e.err?.message);
});
const channels = new Map();
const getQueueChannel = (queueName) => {
    if (!channels.has(queueName)) {
        const channelWrapper = exports.connection.createChannel({
            json: false,
            setup: (channel) => {
                return channel.assertQueue(queueName, { durable: true });
            }
        });
        // Handle channel-specific errors
        // Without this, a channel error (like "Precondition Failed") crashes the whole app
        channelWrapper.on('error', (err) => {
            console.error(`[api/queue.ts] Error in channel for queue "${queueName}":`, err.message);
        });
        channelWrapper.on('close', () => {
            console.warn(`[api/queue.ts] Channel for queue "${queueName}" closed`);
        });
        channels.set(queueName, channelWrapper);
    }
    return channels.get(queueName);
};
exports.getQueueChannel = getQueueChannel;
//# sourceMappingURL=queue.js.map