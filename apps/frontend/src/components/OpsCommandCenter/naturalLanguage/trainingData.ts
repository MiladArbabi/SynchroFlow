//apps/frontend/src/components/OpsCommandCenter/naturalLanguage/trainingData.ts

import { TrainingData } from './types';

/**
 * This is the "dictionary" for Kore's Layer 2 NLP.
 * It maps intents to common phrases and the entities they care about.
 */
export const TRAINING_DATA: TrainingData = {
  'find-orders': {
    phrases: [
      'show me orders',
      'find orders',
      'search for orders',
      'look up orders',
      'display orders',
      'get orders',
    ],
    entities: ['status', 'date', 'customer', 'product'],
  },
  'refund-order': {
    phrases: [
      'refund order',
      'process refund',
      'return money',
      'issue refund',
      'refund customer',
    ],
    entities: ['orderId', 'amount', 'reason'],
  },
  'check-inventory': {
    phrases: [
      'check inventory',
      'stock levels',
      "what's in stock",
      'low stock',
      'inventory status',
    ],
    entities: ['product', 'threshold'],
  },
  'customer-lookup': {
    phrases: [
      'find customer',
      'look up customer',
      'customer details',
      'search customers',
      'get customer info',
    ],
    entities: ['customerName', 'email', 'phone'],
  },
  'daily-report': {
    phrases: [
      'daily report',
      'yesterday performance',
      'today stats',
      'morning report',
      'daily summary',
    ],
    entities: ['date', 'metrics'],
  },
};