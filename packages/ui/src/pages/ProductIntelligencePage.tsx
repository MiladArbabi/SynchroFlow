// packages/ui/src/pages/ProductIntelligencePage.tsx
import React from 'react';

export function ProductIntelligencePage() {
  return (
    <div>
      <div style={{ display: 'flex', gap: '0.5rem' }}>
        <input
          type="search"
          placeholder="Search by SKU..."
          aria-label="Search by SKU" // aria-label helps testing library
          style={{
            flex: 1,
            border: '1px solid #D1D5DB',
            padding: '0.5rem 0.75rem',
          }}
        />
        <button
          type="submit"
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
    </div>
  );
}