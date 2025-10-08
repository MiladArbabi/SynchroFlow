import React from 'react';

// Define the shape of the inventory data prop
interface InventoryData {
  sku: string;
  quantity: number;
  price: number;
  location: string;
}

export function InventoryResult({ data }: { data: InventoryData }) {
  return (
    <div style={{ marginTop: '2rem', padding: '1rem', backgroundColor: 'white', border: '1px solid #E5E7EB' }}>
      <h3 style={{ fontSize: '1.25rem', fontWeight: '600' }}>Real-Time Inventory</h3>
      <div style={{ marginTop: '1rem' }}>
        <p><strong>SKU:</strong> {data.sku}</p>
        <p><strong>Quantity Available:</strong> {data.quantity}</p>
        <p><strong>Price:</strong> ${data.price.toFixed(2)}</p>
        <p><strong>Location:</strong> {data.location}</p>
      </div>
    </div>
  );
}