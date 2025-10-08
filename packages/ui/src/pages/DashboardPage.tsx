import React from 'react';

// A simple placeholder for a KPI widget
const KpiCard = ({ title, value }: { title: string, value: string }) => (
  <div style={{ backgroundColor: 'white', padding: '1.5rem', border: '1px solid #E5E7EB', borderRadius: '0.5rem' }}>
    <h3 style={{ color: '#434D5B', fontSize: '0.875rem', fontWeight: '500' }}>{title}</h3>
    <p style={{ color: '#1F2937', fontSize: '1.875rem', fontWeight: 'bold', marginTop: '0.5rem' }}>{value}</p>
  </div>
);

export function DashboardPage() {
  return (
    <div>
      <h1 style={{ fontSize: '1.875rem', fontWeight: 'bold', color: '#1F2937' }}>
        FinOps Command Center
      </h1>
      <div style={{ marginTop: '2rem', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '1.5rem' }}>
        <KpiCard title="Total Inventory Value" value="$0.00" />
        <KpiCard title="Cash Conversion Cycle" value="--" />
        {/* More KPIs will be added here */}
      </div>
    </div>
  );
}