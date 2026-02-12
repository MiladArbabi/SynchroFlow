// apps/backend/migrations/20251124000000_add_products_indexes.ts
import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // Check if indexes exist before creating them
  const indexExists = async (indexName: string): Promise<boolean> => {
    const result = await knex('pg_indexes')
      .where('indexname', indexName)
      .andWhere('tablename', 'shopify_products')
      .first();
    return !!result;
  };

  // Create indexes only if they don't exist
  const indexesToCreate = [
    { name: 'shopify_products_shop_id_status_index', columns: ['shop_id', 'status'] },
    { name: 'shopify_products_shop_id_inventory_index', columns: ['shop_id', 'total_inventory'] },
    { name: 'shopify_products_shop_id_product_type_index', columns: ['shop_id', 'product_type'] },
    { name: 'shopify_products_shop_id_title_index', columns: ['shop_id', 'title'] },
  ];

  for (const index of indexesToCreate) {
    const exists = await indexExists(index.name);
    if (!exists) {
      await knex.schema.alterTable('shopify_products', (table) => {
        table.index(index.columns, index.name);
      });
      console.log(`Created index: ${index.name}`);
    } else {
      console.log(`Index already exists: ${index.name}`);
    }
  }
}

export async function down(knex: Knex): Promise<void> {
  // Drop only the indexes we created in this migration
  const indexesToDrop = [
    'shopify_products_shop_id_status_index',
    'shopify_products_shop_id_inventory_index', 
    'shopify_products_shop_id_product_type_index',
    'shopify_products_shop_id_title_index',
  ];

  for (const indexName of indexesToDrop) {
    await knex.raw(`DROP INDEX IF EXISTS ${indexName}`);
  }
}
