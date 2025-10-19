// packages/core-engine/__tests__/addon.test.ts
import path from 'path';
import db from '../../api/src/db';
import { execSync } from 'child_process';

// Define interfaces for our data shapes
interface InventoryItem {
  sku: string;
  quantity: number;
  price: number;
  location: string;
}

interface Addon {
  getInventoryItem: (sku: string) => InventoryItem;
  reloadCacheSync: () => void;
}

// 1. Declare the addon variable here, but do not initialize it yet.
let addon: Addon;

describe('C++ Addon (sf_core)', () => {

  // Before all tests, prepare the database AND THEN load the addon.
  beforeAll(async () => {
    // A) Clean the database to ensure a predictable state.
    await db.migrate.latest();

    // Force a rebuild of the C++ addon before loading it.
    // This ensures we are always testing against the latest code.
    execSync('npm run build -w core-engine', { stdio: 'inherit' });

    // Load the addon only ONCE. It does nothing on load.
    const addonPath = path.join(__dirname, '../build/Release/sf_core.node');
    addon = require(addonPath);
  });

  // Before each test, we clean, seed, and synchronously reload the cache.
  beforeEach(async () => {
    await db.raw('TRUNCATE shops, inventory_truth RESTART IDENTITY CASCADE');
    const [shop] = await db('shops').insert({ name: "C++ Test Store", contact_email: "cpp-test@store.com", auth_secret: "cpp-test-secret", platform: "shopify", primary_erp_type: "TestERP", primary_ecomm_type: "TestPlatform" }).returning('id');
    await db('inventory_truth').insert({ sku: 'SYN-TS-RED-LOGO', quantity_available: 95, price: 19.99, warehouse_location: 'Shelf A-1', shop_id: shop.id });
    
    // Call the synchronous reload function. The test will wait here until it's done.
    addon.reloadCacheSync();
   });

  it('should return the correct inventory item from the live-loaded cache', () => {
    const sku = 'SYN-TS-RED-LOGO';
    const item = addon.getInventoryItem(sku);

    expect(item).toBeDefined();
    // This assertion will now pass because the cache was loaded with the correct data.
    expect(item.sku).toBe(sku); 
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