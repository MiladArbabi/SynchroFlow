"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.seedSandboxData = seedSandboxData;
// apps/backend/src/db/seeder.ts
const db_1 = __importDefault(require("../db"));
async function seedSandboxData(shopId) {
    console.log(`[seeder] Starting sandbox data seed for shopId: ${shopId}`);
    // Sample data for a fictional sneaker store
    const sampleInventory = [
        {
            shop_id: shopId,
            sku: 'SYN-RUN-001',
            description: 'The SynchroFlow Runner - Men\'s',
            quantity_available: 150,
            price: 129.99,
            warehouse_location: 'A1-01',
        },
        {
            shop_id: shopId,
            sku: 'SYN-HIKE-002',
            description: 'The SynchroFlow Hiker - Women\'s',
            quantity_available: 85,
            price: 149.99,
            warehouse_location: 'B2-05',
        },
        {
            shop_id: shopId,
            sku: 'SYN-CASUAL-003',
            description: 'The SynchroFlow Casual - Unisex',
            quantity_available: 210,
            price: 99.99,
            warehouse_location: 'C3-10',
        },
    ];
    const sampleMappingRules = [
        {
            shop_id: shopId,
            source_platform: 'shopify',
            source_field_path: 'id',
            target_field_path: 'order.externalId',
        },
        {
            shop_id: shopId,
            source_platform: 'shopify',
            source_field_path: 'customer.email',
            target_field_path: 'customer.emailAddress',
        },
        {
            shop_id: shopId,
            source_platform: 'shopify',
            source_field_path: 'total_price',
            target_field_path: 'financials.totalAmount',
        },
    ];
    // Use a transaction to ensure all or nothing is inserted
    await db_1.default.transaction(async (trx) => {
        // Insert inventory items
        await trx('inventory_truth').insert(sampleInventory);
        console.log(`[seeder] Inserted ${sampleInventory.length} sample inventory items.`);
        // Insert mapping rules
        await trx('data_mapping_rules').insert(sampleMappingRules);
        console.log(`[seeder] Inserted ${sampleMappingRules.length} sample mapping rules.`);
        // We can add more sample data here in the future (e.g., historical_sales)
    });
    console.log(`[seeder] Sandbox data seed completed for shopId: ${shopId}`);
}
//# sourceMappingURL=seeder.js.map