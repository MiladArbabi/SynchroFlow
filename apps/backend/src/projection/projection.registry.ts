// apps/backend/src/projection/projection.registry.ts

import { handleOrdersCreate } from './handlers/orders.create.js';
import { handleOrdersPaid } from './handlers/orders.paid.js';
import { handleOrdersFulfilled } from './handlers/orders.fulfilled.js';
import { handleRefundsCreate } from './handlers/refunds.create.js';
import { handleLifecycleFT0Completed } from './handlers/lifecycle.ft0_completed.js';
import { handleLifecycleFT2Confirmed } from './handlers/lifecycle.ft2_confirmed.js';
import { handleLifecycleFirstInsightDelivered } from './handlers/lifecycle.first_insight_delivered.js';

export type ProjectionHandler = (params: {
  domainEvent: any;
  domain_event_id: number;
  canonicalEventTime: Date;
}) => Promise<void>;

export const projectionRegistry: Record<string, ProjectionHandler> = {
  'orders/create': handleOrdersCreate,
  'orders/sync': handleOrdersCreate,
  'orders/paid': handleOrdersPaid,
  'orders/fulfilled': handleOrdersFulfilled,
  'refunds/create': handleRefundsCreate,
  'lifecycle/ft0_completed': handleLifecycleFT0Completed,
  'lifecycle/ft2_confirmed': handleLifecycleFT2Confirmed,
  'lifecycle/first_insight_delivered': handleLifecycleFirstInsightDelivered,
};