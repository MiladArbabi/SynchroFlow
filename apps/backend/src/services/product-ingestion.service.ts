//apps/backend/src/services/product-ingestion.service.ts

import { getQueueChannel } from '../queue';

export interface ProductIngestionQueueMessage {
  shopId: number;
  platform: 'shopify';
  rawProduct: any;
}

const QUEUE_NAME = 'product_ingestion';

export function enqueueProductForIngestion(
  msg: ProductIngestionQueueMessage
): void {
  const channel = getQueueChannel(QUEUE_NAME);

  if (!channel) {
    console.warn('[product-ingestion] queue unavailable — dropping message');
    return;
  }

  /**
   * IMPORTANT: Producer-side queue assertion
   * ----------------------------------------
   * RabbitMQ drops messages sent to non-existent queues.
   * The worker may not have started yet, so the producer
   * MUST assert the queue before publishing.
   */
  channel.assertQueue(QUEUE_NAME, { durable: true });

  channel.sendToQueue(
    QUEUE_NAME,
    Buffer.from(JSON.stringify(msg)),
    { persistent: true }
  );
}
