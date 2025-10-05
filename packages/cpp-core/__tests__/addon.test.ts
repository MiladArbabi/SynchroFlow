import path from 'path';
import db from '../../api/src/db';

// Define interfaces for our data shapes
interface InventoryItem {
  sku: string;
  quantity: number;
  price: number;
  location: string;
}

interface Addon {
  getInventoryItem: (sku: string) => InventoryItem;
}

// 1. Declare the addon variable here, but do not initialize it yet.
let addon: Addon;

describe('C++ Addon (sf_core)', () => {

  // Before all tests, prepare the database AND THEN load the addon.
  beforeAll(async () => {
    // A) Clean the database to ensure a predictable state.
    await db.migrate.latest();
    await db('inventory_truth').del();
    await db('shops').del();

    // B) Seed the database with the exact data this test suite needs.
    const [shop] = await db('shops').insert({
      name: "C++ Test Store",
      contact_email: "cpp-test@store.com",
      auth_secret: "cpp-test-secret",
      primary_erp_type: "TestERP",
      primary_ecomm_type: "TestPlatform"
    }).returning('id');

    await db('inventory_truth').insert({
      sku: 'SYN-TS-RED-LOGO',
      quantity_available: 95,
      price: 19.99,
      warehouse_location: 'Shelf A-1',
      shop_id: shop.id
    });

    // C) NOW, load the addon. This will run the Init function, which connects
    // to the database and loads the data we just inserted into the cache.
    const addonPath = path.join(__dirname, '../build/Release/sf_core.node');
    addon = require(addonPath);
  });

  // After all tests, clean up the database connection.
  afterAll(async () => {
    await db.destroy();
  });

  it('should be loaded successfully and have the correct functions', () => {
    expect(addon).toBeDefined();
    expect(typeof addon.getInventoryItem).toBe('function');
  });

  it('should return the correct inventory item from the live-loaded cache', () => {
    const sku = 'SYN-TS-RED-LOGO';
    const item = addon.getInventoryItem(sku);

    expect(item).toBeDefined();
    expect(item.sku).toBe(sku);
    // This assertion will now pass because the cache was loaded with the correct data.
    expect(item.quantity).toBe(95);
    expect(item.price).toBe(19.99);
  });

  it('should return a "Not Found" response for a non-existent SKU', () => {
    const sku = 'NON-EXISTENT-SKU';
    const item: any = addon.getInventoryItem(sku);

    expect(item).toBeDefined();
    expect(item.sku).toBe(sku);
    expect(item.location).toBe('Not Found');
  });
});