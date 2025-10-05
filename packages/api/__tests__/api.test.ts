import request from 'supertest';
import app from '../src/server';
import db from '../src/db';
import { InventoryItem } from '../src/types';

describe('Inventory API Endpoints', () => {

  // Before all tests, clean the tables to ensure a fresh start
  beforeAll(async () => {
    await db.migrate.latest();
    // Clean out the tables in reverse order of dependency
    await db('inventory_truth').del();
    await db('shops').del();
  });

  // After all tests, destroy the connection
  afterAll(async () => {
    await db.destroy();
  });

  const testSku = 'TEST-SKU-123';
  let createdShopId: number;

  it('should create a new shop', async () => {
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
    createdShopId = response.body.id;
  });

  it('should create a new inventory item', async () => {
    const response = await request(app)
      .post('/v1/inventory')
      .send({
        sku: testSku,
        description: "A test item",
        quantity: 100,
        price: 9.99,
        warehouse_location: "Test-Bin-1",
        shop_id: createdShopId // This will fail if the previous test fails
      });

    expect(response.statusCode).toBe(201);
    expect(response.body.sku).toBe(testSku);
  });
  
  it('should update an inventory item', async () => {
    const response = await request(app)
      .put(`/v1/inventory/${testSku}`)
      .send({ quantity_available: 90 });

    expect(response.statusCode).toBe(200);
    expect(response.body.quantity_available).toBe(90);
  });

  it('should fetch all inventory items', async () => {
    const response = await request(app).get('/v1/inventory');
    expect(response.statusCode).toBe(200);
    expect(Array.isArray(response.body)).toBe(true);
    expect(response.body.some((item: InventoryItem) => item.sku === testSku)).toBe(true);
  });
});