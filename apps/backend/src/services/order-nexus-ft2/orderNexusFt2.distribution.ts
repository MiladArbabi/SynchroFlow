import db from 'api-db';
import type { OrderFactsPeriod } from 'api-src/services/order-facts/orderFacts.types';

export type OrdersFt2Distribution = {
  totalOrders: number;
  minOrderValue: number | null;
  medianOrderValue: number | null;
  maxOrderValue: number | null;
  histogram: {
    bucketStart: number;
    bucketEnd: number;
    count: number;
  }[];
};

export async function getOrderNexusFt2Distribution(input: {
  shopId: number;
  period: OrderFactsPeriod;
}): Promise<OrdersFt2Distribution> {
  const { shopId, period } = input;

  const values = (await db('canonical_orders')
    .where('shop_id', shopId)
    .andWhere('order_created_at', '>=', period.from)
    .andWhere('order_created_at', '<=', period.to)
    .pluck('total_price'))
    .map((v) => Number(v))
    .filter((v) => Number.isFinite(v));

  if (values.length === 0) {
    return {
      totalOrders: 0,
      minOrderValue: null,
      medianOrderValue: null,
      maxOrderValue: null,
      histogram: [],
    };
  }

  const sorted = [...values].sort((a, b) => a - b);
  const totalOrders = sorted.length;

  const minOrderValue = sorted[0];
  const maxOrderValue = sorted[sorted.length - 1];
  const mid = Math.floor(sorted.length / 2);
  const medianOrderValue =
    sorted.length % 2 === 0
      ? (sorted[mid - 1] + sorted[mid]) / 2
      : sorted[mid];

  // simple deterministic histogram: 5 equal-width buckets
  const bucketCount = 5;
  const range = maxOrderValue - minOrderValue || 1;
  const bucketSize = range / bucketCount;

  const histogram = Array.from({ length: bucketCount }, (_, i) => {
    const start = minOrderValue + i * bucketSize;
    const end = start + bucketSize;
    const count = sorted.filter(
      (v) => v >= start && (i === bucketCount - 1 ? v <= end : v < end)
    ).length;

    return {
      bucketStart: Number(start.toFixed(2)),
      bucketEnd: Number(end.toFixed(2)),
      count,
    };
  });

  return {
    totalOrders,
    minOrderValue,
    medianOrderValue,
    maxOrderValue,
    histogram,
  };
}