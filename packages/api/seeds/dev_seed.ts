// packages/api/seeds/dev_seed.ts
import type { Knex } from "knex";

export async function seed(knex: Knex): Promise<void> {
    // --- Deletes ALL existing entries ---
    // Use raw SQL for TRUNCATE with CASCADE if needed, or delete in reverse order
    console.log("Seeding: Deleting existing data...");
    await knex('order_fulfillment_status').del();
    await knex('shops').del(); // Delete shops after statuses due to foreign key

    // --- Seed Shops ---
    console.log("Seeding: Inserting shops...");
    const [shop] = await knex('shops').insert([
        {
            // You might want more shops, or more realistic data
            name: 'Default Dev Shop',
            contact_email: 'dev@shop.com',
            auth_secret: 'dev_secret',
            primary_erp_type: 'ERP_TYPE', // Adjust as needed
            primary_ecomm_type: 'Shopify', // Adjust as needed
            platform: 'Shopify' // Adjust as needed
        }
    ]).returning('*'); // Get the created shop object, including its ID

    if (!shop) {
        console.error("Seeding: Failed to insert shop!");
        return;
    }
    console.log(`Seeding: Created shop with ID ${shop.id}`);

    // --- Seed Order Fulfillment Statuses ---
    console.log("Seeding: Inserting order fulfillment statuses...");
    await knex('order_fulfillment_status').insert([
        { shop_id: shop.id, order_id: '1001', status: 'processing' },
        { shop_id: shop.id, order_id: '1002', status: 'in_transit' },
        { shop_id: shop.id, order_id: '1003', status: 'delivered' }, // Add more examples
        { shop_id: shop.id, order_id: '1004', status: 'cancelled' },
    ]);

    // --- Seed Other Tables (Optional) ---
    // Add inserts for inventory_truth, historical_sales, etc. if needed
    // Example:
    /*
    console.log("Seeding: Inserting inventory...");
    await knex('inventory_truth').insert([
        { sku: 'SF-TS-BLK-M', shop_id: shop.id, quantity_available: 150, price: 25.00, warehouse_location: 'WH-A' },
        // ... more inventory items
    ]);
    */

    console.log("Seeding: Completed successfully.");
};