// packages/api/__tests__/api.test.ts
import request from 'supertest';
import app from '../src/server';
import db from '../src/db';
import { InventoryItem } from '../src/types';
import axios from 'axios';

// Tell Jest to mock the 'axios' library
jest.mock('axios');
// Create a typed mock for axios.post
const mockedAxiosPost = axios.post as jest.Mock;

beforeAll(async () => {
   await db.migrate.latest();
 });

afterAll(async () => {
  await db.destroy();
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