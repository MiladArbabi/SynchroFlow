"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getQueueChannel = exports.connection = void 0;
// packages/api/src/queue.ts
const amqp_connection_manager_1 = __importDefault(require("amqp-connection-manager"));
const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://guest:guest@localhost:5672';
// We export the connection so our worker can use it
exports.connection = amqp_connection_manager_1.default.connect([RABBITMQ_URL]);
exports.connection.on('disconnect', (e) => console.log('[api/queue.ts] Disconnected from RabbitMQ', e.err.message));
// We use a map to store our channels so we don't create them more than once
const channels = new Map();
const getQueueChannel = (queueName) => {
    if (!channels.has(queueName)) {
        const channelWrapper = exports.connection.createChannel({
            json: false,
            setup: (channel) => {
                return channel.assertQueue(queueName, { durable: true });
            }
        });
        channels.set(queueName, channelWrapper);
    }
    return channels.get(queueName);
};
exports.getQueueChannel = getQueueChannel;
