// packages/ui/src/components/CashFlowChart.tsx
import React from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

interface ChartData {
  name: string;
  cash: number;
}

export function CashFlowChart({ data }: { data: ChartData[] }) {
  return (
    <div style={{ marginTop: '1rem', padding: '1.5rem', backgroundColor: 'white', border: '1px solid #E5E7EB', borderRadius: '0.5rem' }}>
      <h3 style={{ color: '#434D5B', fontSize: '1.25rem', fontWeight: '600' }}>
        Cash Flow Forecast
      </h3>
      <div style={{ height: '300px', marginTop: '1.5rem' }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="name" />
            <YAxis tickFormatter={(value) => `$${(value / 1000).toFixed(0)}k`} />
            <Tooltip formatter={(value: number) => `$${value.toLocaleString()}`} />
            <Legend />
            <Bar dataKey="cash" fill="#2F54EB" name="Net Cash Flow" />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}