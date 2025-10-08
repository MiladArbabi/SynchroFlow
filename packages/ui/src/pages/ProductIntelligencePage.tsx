// packages/ui/src/pages/ProductIntelligencePage.tsx
import React, { useState } from 'react';
import axios from 'axios';
import { InventoryResult } from '../components/InventoryResult';
import { ForecastResult } from '../components/ForecastResult';

// Define the shape of our data for type safety
interface ProductData {
  inventory: {
    sku: string;
    quantity: number;
    price: number;
    location: string;
  };
  forecast: {
    forecast: number[];
  };
}

export function ProductIntelligencePage() {
  const [sku, setSku] = useState('');
  const [data, setData] = useState<ProductData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSearch = async () => {
    setLoading(true);
    setError('');
    setData(null);
    try {
      const response = await axios.get(`/api/v1/products/${sku}/details`);
      setData(response.data);
    } catch (_err) { 
      setError('Failed to fetch data for the specified SKU.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <div style={{ display: 'flex', gap: '0.5rem' }}>
        <input
          type="search"
          placeholder="Search by SKU..."
          aria-label="Search by SKU"
          value={sku}
          onChange={(e) => setSku(e.target.value)}
          style={{
            flex: 1,
            border: '1px solid #D1D5DB',
            padding: '0.5rem 0.75rem',
          }}
        />
        <button
          type="button"
          onClick={handleSearch}
          style={{
            backgroundColor: '#2F54EB', // Primary Blue
            color: 'white',
            fontWeight: '600',
            padding: '0.5rem 1rem',
            border: 'none',
          }}
        >
          Search
        </button>
      </div>

      {loading && <p style={{ marginTop: '2rem' }}>Loading...</p>}
      {error && <p style={{ marginTop: '2rem', color: '#F84D4D' }}>{error}</p>}
      {data && (
        <div>
          <InventoryResult data={data.inventory} />
          <ForecastResult data={data.forecast} />
        </div>
      )}
    </div>
  );
}