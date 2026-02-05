import db from 'api-src/db';

export async function resolveRefundLineItemIdentity(
  refundExecutionId: number
): Promise<void> {
  const lines = await db('refund_execution_line_items')
    .where({ refund_execution_id: refundExecutionId });

  for (const line of lines) {
    // Normalize Shopify line item ID to GID
    const platformLineItemGid = `gid://shopify/LineItem/${line.sku}`;

    const mapping = await db('canonical_order_line_items')
      .where({ platform_line_item_id: platformLineItemGid })
      .first();

    if (!mapping?.canonical_variant_code) continue;

    await db('refund_execution_line_items')
      .where({ id: line.id })
      .update({
        sku: mapping.canonical_variant_code,
      });
  }
}
