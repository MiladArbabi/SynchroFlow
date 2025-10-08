// packages/ui/src/pages/DashboardPage.tsx
import React, { useState, useEffect } from 'react';
import axios from 'axios'
import { CashFlowChart } from '../components/CashFlowChart';

// A simple placeholder for a KPI widget
const KpiCard = ({ title, value, isLoading }: { title: string, value: string, isLoading: boolean }) => (
  <div style={{ backgroundColor: 'white', padding: '1.5rem', border: '1px solid #E5E7EB', borderRadius: '0.5rem' }}>
    <h3 style={{ color: '#434D5B', fontSize: '0.875rem', fontWeight: '500' }}>{title}</h3>
    <p style={{ color: '#1F2937', fontSize: '1.875rem', fontWeight: 'bold', marginTop: '0.5rem' }}>
      {isLoading ? 'Loading...' : value}
    </p>
  </div>
);

export function DashboardPage() {
  const [inventoryValue, setInventoryValue] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const fetchInventoryValue = async () => {
      try {
        const response = await axios.get('/api/v1/analytics/inventory-value');
        setInventoryValue(response.data.total_inventory_value);
      } catch {
        setError('Failed to fetch inventory value.');
      } finally {
        setIsLoading(false);
      }
    };

    fetchInventoryValue();
  }, []); // Empty array ensures this runs only once on mount

  const formattedValue = inventoryValue !== null
    ? `$${inventoryValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : '--';

    const sampleCashFlowData = [
    { name: 'Week 1', cash: 10000 },
    { name: 'Week 2', cash: -5000 },
    { name: 'Week 3', cash: 12000 },
  ];

  return (
    <div>
      <h1 style={{ fontSize: '1.875rem', fontWeight: 'bold', color: '#1F2937' }}>
        FinOps Command Center
      </h1>
      {error && <p style={{ marginTop: '1rem', color: '#F84D4D' }}>{error}</p>}
      <div style={{ marginTop: '2rem', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '1.5rem' }}>
        <KpiCard title="Total Inventory Value" value={formattedValue} isLoading={isLoading} />
        <KpiCard title="Cash Conversion Cycle" value="--" isLoading={false} />
        {/* More KPIs will be added here */}
      </div>
      <CashFlowChart data={sampleCashFlowData} />
    </div>
  );
}