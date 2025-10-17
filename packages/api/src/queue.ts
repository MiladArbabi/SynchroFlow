// packages/api/src/queue.ts
import amqp from 'amqp-connection-manager';
import { AmqpConnectionManager, ChannelWrapper } from 'amqp-connection-manager';
import { Channel } from 'amqplib';

const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://guest:guest@localhost:5672';

// We export the connection so our worker can use it
export const connection: AmqpConnectionManager = amqp.connect([RABBITMQ_URL]);
export let channelWrapper: ChannelWrapper;

connection.on('disconnect', (e: { err: Error }) => console.log('[api/queue.ts] Disconnected from RabbitMQ', e.err.message));

channelWrapper = connection.createChannel({
  json: false,
  setup: (channel: Channel) => {
    return channel.assertQueue('events', { durable: true });
  }
});