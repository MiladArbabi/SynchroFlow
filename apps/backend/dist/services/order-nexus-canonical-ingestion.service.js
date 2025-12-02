"use strict";
// apps/backend/src/services/order-nexus-canonical-ingestion.service.ts
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.OrderNexusCanonicalIngestionService = void 0;
const db_1 = __importDefault(require("api-src/db"));
const queue_1 = require("api-src/queue");
class OrderNexusCanonicalIngestionService {
    constructor() {
        this.queueName = 'order_nexus_ingestion';
        this.channel = (0, queue_1.getQueueChannel)(this.queueName);
    }
    async enqueueOrderForOrderNexus(shopId, orderId) {
        // 1) Load canonical order – use .from() so the test sees it
        const orderRow = await (0, db_1.default)()
            .from('canonical_orders')
            .where({ shop_id: shopId, id: orderId })
            .first();
        if (!orderRow) {
            // FT0: silently no-op if there's no canonical row
            return;
        }
        // 2) Load canonical line items – again via .from()
        const lineItemRows = await (0, db_1.default)()
            .from('canonical_order_line_items')
            .where({ shop_id: shopId, order_id: orderId });
        // 3) Map to the minimal NormalizedOrder shape OrderNexus expects
        const normalizedOrder = {
            id: orderRow.id,
            shopId: orderRow.shop_id,
            createdAt: orderRow.created_at,
            updatedAt: orderRow.updated_at,
            ...(orderRow.processed_at
                ? { processedAt: orderRow.processed_at }
                : {}),
            currency: orderRow.currency,
            totalPrice: Number(orderRow.total_price),
            subtotalPrice: Number(orderRow.subtotal_price),
            totalTax: Number(orderRow.total_tax ?? 0),
            shippingLines: [], // FT0: shippingLines omitted
            lineItems: lineItemRows.map((li) => ({
                productId: li.product_id ? String(li.product_id) : null,
                variantId: li.variant_id ? String(li.variant_id) : undefined,
                quantity: li.quantity,
                price: li.unit_price,
            })),
        };
        const msg = {
            shopId: orderRow.shop_id,
            orderId: orderRow.id,
            topic: 'orders/create',
            order: normalizedOrder,
        };
        this.channel.sendToQueue(this.queueName, Buffer.from(JSON.stringify(msg)));
    }
}
exports.OrderNexusCanonicalIngestionService = OrderNexusCanonicalIngestionService;
exports.default = OrderNexusCanonicalIngestionService;
//# sourceMappingURL=order-nexus-canonical-ingestion.service.js.map