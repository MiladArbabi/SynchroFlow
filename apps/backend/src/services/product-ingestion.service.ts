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

  console.log('[product-ingestion] enqueue called', {
    shopId: msg.shopId,
    productId: msg.rawProduct?.id,
    queueEnabled: !!channel,
  });

  if (!channel) {
    console.warn('[product-ingestion] queue unavailable — dropping message');
    return;
  }

  channel.sendToQueue(
    QUEUE_NAME,
    Buffer.from(JSON.stringify(msg))
  );
}
