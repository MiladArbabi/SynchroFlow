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

afterAll(async () => {
  await db.destroy();
});

describe('API Endpoints', () => {
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
    const testSku = 'INV-ITEM-001';
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
    const testSku = 'UPDATE-SKU-001';
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
    const testSku = 'FETCH-SKU-001';
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
});