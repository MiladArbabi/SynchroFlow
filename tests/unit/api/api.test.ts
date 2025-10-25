// packages/api/__tests__/api.test.ts
import request from 'supertest';
import app from 'api-server';
import db from 'api-db';
import { InventoryItem } from 'api-types';
import axios from 'axios';
import { seedSandboxData } from '../../../packages/api/src/db/seeder';

// Tell Jest to mock the 'axios' library
jest.mock('axios');
// Create a typed mock for axios.post
const mockedAxiosPost = axios.post as jest.Mock;

// Mock our new seeder function
jest.mock('../../../packages/api/src/db/seeder');
const mockedSeedSandboxData = seedSandboxData as jest.Mock;

beforeAll(async () => {
   await db.migrate.latest();
 });

describe('API Endpoints', () => {
  // This beforeEach hook now only applies to tests inside THIS describe block
  beforeEach(async () => {
  await db('historical_sales').del();
  await db('product_costs').del();
  await db('inventory_truth').del();
  await db('shops').del();
});

  const testSku = 'TEST-SKU-123';
  // Each test in this block is now fully independent.
  it('POST /v1/shops - should create a new shop and return it', async () => {
    const response = await request(app)
      .post('/v1/shops')
      .send({
        name: "Test Store",
        contact_email: "test@store.com",
        auth_secret: "test-secret",
        primary_erp_type: "TestERP",
        primary_ecomm_type: "TestPlatform"
      });
    expect(response.statusCode).toBe(201);
    expect(response.body).toHaveProperty('id');
    expect(response.body.name).toBe("Test Store");
  });

  it('POST /v1/inventory - should create a new inventory item', async () => {
    // 1. Create the shop this item will belong to.
    const shopResponse = await request(app).post('/v1/shops').send({
      name: "Inventory Test Store",
      contact_email: "inventory-test@store.com",
      auth_secret: "inv-secret",
      primary_erp_type: "TestERP",
      primary_ecomm_type: "TestPlatform"
    });
    const shopId = shopResponse.body.id;

  // 2. Now create the inventory item.
    const response = await request(app)
      .post('/v1/inventory')
      .send({
        sku: testSku,
        description: "A test item",
        quantity: 100,
        price: 9.99,
        warehouse_location: "Test-Bin-1",
        shop_id: shopId
      });

    expect(response.statusCode).toBe(201);
    expect(response.body.sku).toBe(testSku);
  });
  
 it('PUT /v1/inventory/:sku - should update an inventory item', async () => {
    // 1. Create the prerequisite shop and item.
    const shopResponse = await request(app).post('/v1/shops').send({
      name: "Update Test Store", contact_email: "update@store.com", auth_secret: "upd-secret",
      primary_erp_type: "TestERP", primary_ecomm_type: "TestPlatform"
    });
    const shopId = shopResponse.body.id;
    await request(app).post('/v1/inventory').send({
        sku: testSku, description: "Item to be updated", quantity: 100,
        price: 9.99, warehouse_location: "Test-Bin-1", shop_id: shopId
    });

    // 2. Now, update the item.
    const response = await request(app)
      .put(`/v1/inventory/${testSku}`)
      .send({ quantity_available: 90 });

    expect(response.statusCode).toBe(200);
    expect(response.body.quantity_available).toBe(90);
  });

 it('GET /v1/inventory - should fetch all inventory items', async () => {
    // 1. Create the prerequisite shop and item.
    const shopResponse = await request(app).post('/v1/shops').send({
      name: "Fetch Test Store", contact_email: "fetch@store.com", auth_secret: "fetch-secret",
      primary_erp_type: "TestERP", primary_ecomm_type: "TestPlatform"
    });
    const shopId = shopResponse.body.id;
    await request(app).post('/v1/inventory').send({
        sku: testSku, description: "Item to be fetched", quantity: 100,
        price: 9.99, warehouse_location: "Test-Bin-1", shop_id: shopId
    });

    // 2. Now, fetch the items.
    const response = await request(app).get('/v1/inventory');
    expect(response.statusCode).toBe(200);
    expect(Array.isArray(response.body)).toBe(true);
    expect(response.body.some((item: InventoryItem) => item.sku === testSku)).toBe(true);
  });

it('POST /v1/data/sales - should create a new historical sales record', async () => {
    // We need a shop and an item to exist first
    const shopResponse = await request(app).post('/v1/shops').send({
      name: "TDD Store",
      contact_email: "tdd@store.com",
      auth_secret: "tdd-secret",
      primary_erp_type: "TestERP",
      primary_ecomm_type: "TestPlatform"
    });
    const shopId = shopResponse.body.id;

    await request(app).post('/v1/inventory').send({
      sku: "TDD-SKU-001",
      description: "A TDD test item",
      quantity: 1, price: 1, warehouse_location: "TDD-Bin", shop_id: shopId
    });

    // Now, test the actual endpoint
    const response = await request(app)
      .post('/v1/data/sales')
      .send({
        shop_id: shopId,
        sku: "TDD-SKU-001",
        sale_date: "2025-10-07",
        quantity_sold: 5
      });

    expect(response.statusCode).toBe(201);
    expect(response.body).toHaveProperty('id');
    expect(response.body.sku).toBe("TDD-SKU-001");
    expect(response.body.quantity_sold).toBe(5);
  });

it('GET /v1/forecast/demand/:sku - should fetch data and return a forecast', async () => {
    // --- 1. SETUP ---
    // Create the shop that the sales records will belong to.
    const shopResponse = await request(app).post('/v1/shops').send({
      name: "Forecast Store",
      contact_email: "forecast@store.com",
      auth_secret: "forecast-secret",
      primary_erp_type: "TestERP",
      primary_ecomm_type: "TestPlatform"
    });

    const shopId = shopResponse.body.id;

    // Seed the database with historical sales data for that shop
    const testSku = "FORECAST-SKU-001";
    await db('historical_sales').insert([
      { shop_id: shopId, sku: testSku, sale_date: "2025-01-01", quantity_sold: 10 },
      { shop_id: shopId, sku: testSku, sale_date: "2025-02-01", quantity_sold: 12 },
      { shop_id: shopId, sku: testSku, sale_date: "2025-03-01", quantity_sold: 15 },
    ]);

    // Define the fake response our mocked AI engine will return
    const fakeForecast = {
      sku: testSku,
      forecast: [16.5, 17.0, 18.2]
    };
    // Tell our mock to return this fake data when called
    mockedAxiosPost.mockResolvedValue({ data: fakeForecast });

    // --- 2. EXECUTION ---
    // Call our real API endpoint
    const response = await request(app).get(`/v1/forecast/demand/${testSku}`);

    // --- 3. ASSERTION ---
    // Check that the API returned the correct status and the data from our mock
    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual(fakeForecast);

    // Crucially, verify that our API called the AI engine with the CORRECT data from the database
    expect(mockedAxiosPost).toHaveBeenCalledWith("http://127.0.0.1:8000/predict/demand", {
      sku: testSku,
      historical_sales: [10, 12, 15] // This proves we queried the DB correctly
    });
  });

it('POST /v1/data/product-costs - should create a new product cost record', async () => {
    // 1. Create the shop and inventory item this cost record will link to
    const shopResponse = await request(app).post('/v1/shops').send({ name: "Cost Test Store", contact_email: "cost@store.com", auth_secret: "cost-secret", primary_erp_type: "TestERP", primary_ecomm_type: "TestPlatform" });
    const shopId = shopResponse.body.id;
    await request(app).post('/v1/inventory').send({ sku: "COST-SKU-001", description: "A test item for costs", quantity: 1, price: 1, warehouse_location: "Cost-Bin", shop_id: shopId });

    // 2. Now, test the new endpoint
    const response = await request(app)
      .post('/v1/data/product-costs')
      .send({
        sku: "COST-SKU-001",
        purchase_price: 15.50,
        landed_cost_per_unit: 18.75
      });

    expect(response.statusCode).toBe(201);
    expect(response.body.sku).toBe("COST-SKU-001");
    expect(response.body.landed_cost_per_unit).toBe("18.75"); // Knex returns decimal as string
  });

it('GET /v1/analytics/inventory-value - should calculate and return the total value', async () => {
    // --- 1. SETUP ---
    // Create a shop for the inventory
    const shopResponse = await request(app).post('/v1/shops').send({ name: "Analytics Test Store", contact_email: "analytics@store.com", auth_secret: "analytics-secret", primary_erp_type: "TestERP", primary_ecomm_type: "TestPlatform" });
    const shopId = shopResponse.body.id;

    // Seed the database with a few inventory items
    await db('inventory_truth').insert([
      { sku: "VAL-001", shop_id: shopId, quantity_available: 10, price: 25.50, description: "Item 1" }, // Value: 255.00
      { sku: "VAL-002", shop_id: shopId, quantity_available: 5, price: 100.00, description: "Item 2" }, // Value: 500.00
      { sku: "VAL-003", shop_id: shopId, quantity_available: 200, price: 1.50, description: "Item 3" }, // Value: 300.00
    ]);

    // --- 2. EXECUTION ---
    const response = await request(app).get('/v1/analytics/inventory-value');

    // --- 3. ASSERTION ---
    const expectedTotalValue = 255.00 + 500.00 + 300.00; // 1055.00

    expect(response.statusCode).toBe(200);
    expect(response.body).toHaveProperty('total_inventory_value');
    expect(response.body.total_inventory_value).toBeCloseTo(expectedTotalValue);
  });
});

describe('POST /v1/simulations/payment-delay', () => {
  it('should calculate the impact of delaying a payment on a cash flow forecast', async () => {
    // --- 1. SETUP ---
    // This is the input to our simulation.
    const requestBody = {
      // A simplified cash flow forecast (e.g., net cash for the next 4 weeks)
      current_cash_flow: [10000, -5000, 12000, 8000],
      payment_details: {
        amount: 7500,
        original_due_week: 1, // Due in the 2nd week (0-indexed)
        delay_weeks: 2       // Delay it by 2 weeks
      }
    };

    // This is the result we expect the simulation to produce.
    const expected_simulated_flow = [10000, 2500, 12000, 500];

    // --- 2. EXECUTION ---
    const response = await request(app)
      .post('/v1/simulations/payment-delay')
      .send(requestBody);

    // --- 3. ASSERTION ---
    expect(response.statusCode).toBe(200);
    expect(response.body.simulated_cash_flow).toEqual(expected_simulated_flow);
  });
});

describe('Data Mapping Rules API', () => {
  // We need a shop_id to associate rules with, let's create one before tests run.
  let shopId: number;

  beforeAll(async () => {
    // Clean the tables before all tests in this block
    await db('data_mapping_rules').del();
    await db('shops').del();
    
    // Create a dummy shop to satisfy the foreign key constraint
    const [shop] = await db('shops').insert({ 
      name: 'Test Shop for Mappings', 
      platform: 'shopify', 
      contact_email: 'test@shop.com',
      auth_secret: 'mapping-test-secret',
      primary_erp_type: 'TestERP',
      primary_ecomm_type: 'TestPlatform'
    }).returning('id');
    shopId = shop.id;
  });

  beforeEach(async () => {
    // Clean the mapping rules table before each test in this suite
    await db('data_mapping_rules').del();
  });
  
  it('should create a new data mapping rule', async () => {
    const newRule = {
      shop_id: shopId,
      source_platform: 'shopify',
      source_field_path: 'order.line_items[0].sku',
      target_field_path: 'synchroflow.product_sku'
    };

    const response = await request(app)
      .post('/api/v1/mappings')
      .send(newRule);

    expect(response.status).toBe(201);
    expect(response.body).toHaveProperty('id');
    expect(response.body.source_platform).toBe('shopify');
  });

  it('should retrieve all mapping rules for a given shop_id', async () => {
    // --- 1. SETUP ---
    // Seed the database with a couple of rules for our test shop
    await db('data_mapping_rules').insert([
      {
        shop_id: shopId,
        source_platform: 'shopify',
        source_field_path: 'customer.email',
        target_field_path: 'synchroflow.customer_email'
      },
      {
        shop_id: shopId,
        source_platform: 'shopify',
        source_field_path: 'order.total_price',
        target_field_path: 'synchroflow.order_total'
      }
    ]);

    // --- 2. EXECUTION ---
    const response = await request(app)
      .get(`/api/v1/mappings?shop_id=${shopId}`);

    // --- 3. ASSERTION ---
    expect(response.status).toBe(200);
    expect(Array.isArray(response.body)).toBe(true);
    expect(response.body.length).toBe(2);
    expect(response.body[0].target_field_path).toBe('synchroflow.customer_email');
  });

  it('should update an existing data mapping rule', async () => {
    // --- 1. SETUP ---
    // First, create a rule that we can then update.
    const [originalRule] = await db('data_mapping_rules').insert({
      shop_id: shopId,
      source_platform: 'shopify',
      source_field_path: 'order.original_path',
      target_field_path: 'synchroflow.original_path'
    }).returning('*');

    const updatedData = {
      target_field_path: 'synchroflow.UPDATED_PATH'
    };

    // --- 2. EXECUTION ---
    const response = await request(app)
      .put(`/api/v1/mappings/${originalRule.id}`)
      .send(updatedData);

    // --- 3. ASSERTION ---
    expect(response.status).toBe(200);
    expect(response.body.target_field_path).toBe('synchroflow.UPDATED_PATH');
    expect(response.body.id).toBe(originalRule.id);
  });

  it('should delete an existing data mapping rule', async () => {
    // --- 1. SETUP ---
    // Create a rule that we can then delete.
    const [ruleToDelete] = await db('data_mapping_rules').insert({
      shop_id: shopId,
      source_platform: 'shopify',
      source_field_path: 'order.to_be_deleted',
      target_field_path: 'synchroflow.to_be_deleted'
    }).returning('*');

    // --- 2. EXECUTION ---
    const deleteResponse = await request(app)
      .delete(`/api/v1/mappings/${ruleToDelete.id}`);

    // --- 3. ASSERTION ---
    // Assert that the delete operation was successful
    expect(deleteResponse.status).toBe(204);

    // As an extra check, try to fetch the deleted rule and expect a 404
    const getResponse = await db('data_mapping_rules').where({ id: ruleToDelete.id }).first();
    expect(getResponse).toBeUndefined();
  });

});

describe('Dev Endpoints', () => {
  it('POST /api/v1/dev/seed-sandbox/:shop_id should call the seeder function', async () => {
    const testShopId = 99;

    const response = await request(app)
      .post(`/api/v1/dev/seed-sandbox/${testShopId}`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ message: `Sandbox data seeded for shopId: ${testShopId}` });

    // The most important assertion: verify our endpoint called the seeder
    expect(mockedSeedSandboxData).toHaveBeenCalledWith(testShopId);
  });
});

describe('GET /api/v1/analytics/gross-revenue', () => {
  let shopId: number;

  beforeEach(async () => {
    // Clean and seed the database with necessary data for this test
    await db.raw('TRUNCATE shops, inventory_truth, historical_sales RESTART IDENTITY CASCADE');
    
    const [shop] = await db('shops').insert({
      name: "Revenue Test Store",
      platform: "shopify",
      contact_email: "revenue@test.com",
      auth_secret: "revenue-secret",
      primary_erp_type: "TestERP",
      primary_ecomm_type: "TestPlatform"
    }).returning('id');
    shopId = shop.id;

    // Seed some products with prices
    await db('inventory_truth').insert([
      { sku: 'REV-SKU-01', shop_id: shopId, price: 100.00, quantity_available: 10 },
      { sku: 'REV-SKU-02', shop_id: shopId, price: 50.00, quantity_available: 10 },
    ]);

    // Seed some historical sales for those products
    await db('historical_sales').insert([
      { shop_id: shopId, sku: 'REV-SKU-01', quantity_sold: 5, sale_date: new Date() }, // 5 * 100 = 500
      { shop_id: shopId, sku: 'REV-SKU-02', quantity_sold: 10, sale_date: new Date() }, // 10 * 50 = 500
    ]);
  });

  it('should calculate and return the total gross revenue', async () => {
    const response = await request(app)
      .get('/v1/analytics/gross-revenue')
      .query({ shop_id: shopId });
    
    const expectedRevenue = 1000.00; // 500 + 500

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('gross_revenue');
    expect(response.body.gross_revenue).toBeCloseTo(expectedRevenue);
  });
});

describe('GET /v1/analytics/gross-margin', () => {
  let shopId: number;

  beforeEach(async () => {
    // This will clean all tables before this test runs
    await db.raw('TRUNCATE shops, inventory_truth, historical_sales, product_costs RESTART IDENTITY CASCADE');
    
    const [shop] = await db('shops').insert({ name: "Margin Test Store", platform: "shopify", contact_email: "margin@test.com", auth_secret: "margin-secret", primary_erp_type: "TestERP", primary_ecomm_type: "TestPlatform" }).returning('id');
    shopId = shop.id;

    // Seed products with prices
    await db('inventory_truth').insert([
      { sku: 'MARGIN-SKU-01', shop_id: shopId, price: 100.00, quantity_available: 10 },
      { sku: 'MARGIN-SKU-02', shop_id: shopId, price: 200.00, quantity_available: 10 },
    ]);

    // Seed costs for those products
    await db('product_costs').insert([
        { sku: 'MARGIN-SKU-01', purchase_price: 35.00, landed_cost_per_unit: 40.00 },
        { sku: 'MARGIN-SKU-02', purchase_price: 140.00, landed_cost_per_unit: 150.00 },
    ]);

    // Seed some sales
    await db('historical_sales').insert([
      { shop_id: shopId, sku: 'MARGIN-SKU-01', quantity_sold: 10, sale_date: new Date() }, // Revenue: 1000, COGS: 400
      { shop_id: shopId, sku: 'MARGIN-SKU-02', quantity_sold: 5, sale_date: new Date() }, // Revenue: 1000, COGS: 750
    ]);
  });

  it('should calculate and return the gross margin percentage', async () => {
    const response = await request(app)
      .get(`/v1/analytics/gross-margin?shop_id=${shopId}`);
    
    // Total Revenue = 1000 + 1000 = 2000
    // Total COGS = 400 + 750 = 1150
    // Gross Profit = 2000 - 1150 = 850
    // Gross Margin % = (850 / 2000) * 100 = 42.5
    const expectedMargin = 42.5;

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('gross_margin_percentage');
    expect(response.body.gross_margin_percentage).toBeCloseTo(expectedMargin);
  });
});

describe('GET /v1/analytics/inventory-health', () => {
  let shopId: number;

  beforeEach(async () => {
    // This single command efficiently cleans all necessary tables.
    await db.raw('TRUNCATE shops, inventory_truth RESTART IDENTITY CASCADE');

    const [shop] = await db('shops').insert({ 
      name: "Health Test Store", 
      platform: "shopify",
      contact_email: "health@test.com",
     auth_secret: "health-secret",
     primary_erp_type: "Test",
     primary_ecomm_type: "Test" 
    }).returning('id');
    shopId = shop.id;

    // Seed inventory with different stock levels
    await db('inventory_truth').insert([
      // Healthy: quantity > 10
      { sku: 'HEALTHY-SKU', shop_id: shopId, quantity_available: 50, price: 10 },
      // At Risk: quantity between 1 and 10
      { sku: 'AT-RISK-SKU', shop_id: shopId, quantity_available: 5, price: 10 },
      // Stockout: quantity = 0
      { sku: 'STOCKOUT-SKU', shop_id: shopId, quantity_available: 0, price: 10 },
    ]);
  });

  it('should return a list of products with their inventory health status', async () => {
    const response = await request(app)
      .get('/v1/analytics/inventory-health')
      .query({ shop_id: shopId });

    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(3);

    // Find each item in the response and check its status
    const healthyItem = response.body.find((item: any) => item.sku === 'HEALTHY-SKU');
    const atRiskItem = response.body.find((item: any) => item.sku === 'AT-RISK-SKU');
    const stockoutItem = response.body.find((item: any) => item.sku === 'STOCKOUT-SKU');

    expect(healthyItem.status).toBe('Healthy');
    expect(atRiskItem.status).toBe('At Risk');
    expect(stockoutItem.status).toBe('Stockout');
  });
});

describe('GET /v1/analytics/cost-of-stockout', () => {
  let shopId: number;
  const testSku = 'STOCKOUT-SKU-01';

  beforeEach(async () => {
    await db.raw('TRUNCATE shops, inventory_truth, historical_sales, product_costs RESTART IDENTITY CASCADE');

    const [shop] = await db('shops').insert({
      name: "Stockout Test Store",
      platform: "shopify",
      contact_email: "stockout@test.com",
      auth_secret: "so-secret",
      primary_erp_type: "Test",
      primary_ecomm_type: "Test"
    }).returning('id');
    shopId = shop.id;

    // Seed product with price
    await db('inventory_truth').insert({
      sku: testSku,
      shop_id: shopId,
      price: 100.00,
      quantity_available: 10
    });

    // Seed cost for the product
    await db('product_costs').insert({
      sku: testSku,
      purchase_price: 50.00,
      landed_cost_per_unit: 60.00
    });

    // Seed 10 days of sales data (30 units total -> 3 units/day)
    for (let i = 1; i <= 10; i++) {
      await db('historical_sales').insert({
        shop_id: shopId,
        sku: testSku,
        quantity_sold: 3,
        sale_date: new Date(`2025-10-${String(i).padStart(2, '0')}`)
      });
    }
  });

  it('should calculate and return the cost of stockout for a given SKU', async () => {
    const response = await request(app)
      .get('/v1/analytics/cost-of-stockout')
      .query({ shop_id: shopId, sku: testSku });

    // Calculation:
    // Daily Sales Velocity = 30 units / 10 days = 3 units/day
    // Profit Per Unit = $100 (price) - $60 (cost) = $40
    // Lead Time = 14 days (hardcoded)
    // Cost of Stockout = 3 * 14 * 40 = $1680
    const expectedCost = 1680;

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('cost_of_stockout');
    expect(response.body.cost_of_stockout).toBeCloseTo(expectedCost);
  });
});

describe('GET /v1/analytics/fulfillment-pipeline', () => {
  let shopId: number;

  beforeEach(async () => {
    // Run migrations to ensure our new table exists for this test suite
    await db.migrate.latest();

    const [shop] = await db('shops').insert({
      name: "Fulfillment Test Store",
      platform: "shopify",
      contact_email: "fulfill@test.com",
      auth_secret: "fulfill-secret",
      primary_erp_type: "Test",
      primary_ecomm_type: "Test"
    }).returning('id');
    shopId = shop.id;

    // Seed fulfillment statuses
    await db('order_fulfillment_status').insert([
      { shop_id: shopId, order_id: '1001', status: 'processing' },
      { shop_id: shopId, order_id: '1002', status: 'processing' },
      { shop_id: shopId, order_id: '1003', status: 'in_transit' },
      { shop_id: shopId, order_id: '1004', status: 'delivered' },
      { shop_id: shopId, order_id: '1005', status: 'delivered' },
      { shop_id: shopId, order_id: '1006', status: 'delivered' },
    ]);
  });

  afterEach(async () => {
    // Rollback migrations after each test to keep the environment clean
    await db.migrate.rollback();
  });

  it('should return aggregated counts for each fulfillment status', async () => {
    const response = await request(app)
      .get('/v1/analytics/fulfillment-pipeline')
      .query({ shop_id: shopId });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      processing: 2,
      in_transit: 1,
      delivered: 3,
    });
  });
});

describe('GET /v1/analytics/perfect-order-percentage', () => {
  let shopId: number;

  beforeEach(async () => {
    // Run migrations to ensure our new column exists
    await db.migrate.latest();

    const [shop] = await db('shops').insert({
      name: "Perfect Order Test Store",
      platform: "shopify",
      contact_email: "perfect@test.com",
      auth_secret: "perfect-secret",
      primary_erp_type: "Test",
      primary_ecomm_type: "Test"
    }).returning('id');
    shopId = shop.id;

    // Seed fulfillment statuses with and without issues
    await db('order_fulfillment_status').insert([
      // 8 perfect orders
      { shop_id: shopId, order_id: '1001', status: 'delivered', has_issue: false },
      { shop_id: shopId, order_id: '1002', status: 'delivered', has_issue: false },
      { shop_id: shopId, order_id: '1003', status: 'delivered', has_issue: false },
      { shop_id: shopId, order_id: '1004', status: 'delivered', has_issue: false },
      { shop_id: shopId, order_id: '1005', status: 'delivered', has_issue: false },
      { shop_id: shopId, order_id: '1006', status: 'delivered', has_issue: false },
      { shop_id: shopId, order_id: '1007', status: 'delivered', has_issue: false },
      { shop_id: shopId, order_id: '1008', status: 'delivered', has_issue: false },
      // 2 imperfect orders
      { shop_id: shopId, order_id: '1009', status: 'delivered', has_issue: true },
      { shop_id: shopId, order_id: '1010', status: 'delivered', has_issue: true },
    ]);
  });

  afterEach(async () => {
    // Rollback migrations to keep the test environment clean for other tests
    await db.migrate.rollback();
  });

  it('should calculate and return the perfect order percentage', async () => {
    const response = await request(app)
      .get('/v1/analytics/perfect-order-percentage')
      .query({ shop_id: shopId });

    // Calculation: 8 perfect orders / 10 total orders = 80%
    const expectedPercentage = 80.0;

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('perfect_order_percentage');
    expect(response.body.perfect_order_percentage).toBeCloseTo(expectedPercentage);
  });
});

describe('API Health Check', () => {
  it('GET / should return 200 OK', async () => {
    const response = await request(app).get('/');
    expect(response.status).toBe(200);
  });
});

describe('Ops-Intel Endpoint (#282)', () => {
  describe('GET /api/v1/ops-intel/summary', () => {
    
    // MODIFICATION: Update test for 200
    it('should return the Ops-Intel summary data', async () => {
      const response = await request(app).get('/api/v1/ops-intel/summary');
      
      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        automated_tasks: 4500,
        labor_cost_saved: 8125.75,
      });
    });

  });
});

describe('Order Endpoint (#288)', () => {
  describe('GET /api/v1/orders/:id/status', () => {
    
    // MODIFICATION: Update test for 200
    it('should return the order status', async () => {
      const response = await request(app).get('/api/v1/orders/12345/status');
      
      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        orderId: '12345',
        status: 'Picking',
      });
    });

  });
});