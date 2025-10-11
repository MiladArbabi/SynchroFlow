// packages/ui/src/pages/ProductsPage.tsx
import React, { useState } from 'react';
import axios from 'axios';

// This will eventually be replaced with a real inventory list component
const PlaceholderProductList: React.FC = () => (
  <div className="mt-8">
    <p className="text-gray-500">A table of all products will be displayed here.</p>
  </div>
);

export function ProductsPage() {
  const [sku, setSku] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSearch = async () => {
    setLoading(true);
    setError('');
    try {
      // Note: This endpoint `/api/v1/products/${sku}/details` doesn't exist yet.
      // This is expected and will be built in a future task.
      await axios.get(`/api/v1/products/${sku}/details`);
    } catch (err) {
        console.error(err.message);
        setError('Search functionality is not yet implemented.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <h1 className="text-2xl font-bold">Products</h1>
      <p className="mt-2 text-sm text-gray-500">Your single source of truth for all product and inventory data.</p>
      
      <div className="mt-4" style={{ display: 'flex', gap: '0.5rem' }}>
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
      
      <PlaceholderProductList />
    </div>
  );
}