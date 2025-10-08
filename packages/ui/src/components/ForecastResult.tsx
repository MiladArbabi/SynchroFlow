import React from 'react';

interface ForecastData {
  forecast: number[];
}

export function ForecastResult({ data }: { data: ForecastData }) {
  return (
    <div style={{ marginTop: '1rem', padding: '1rem', backgroundColor: 'white', border: '1px solid #E5E7EB' }}>
      <h3 style={{ fontSize: '1.25rem', fontWeight: '600' }}>AI Demand Forecast</h3>
      <p style={{ marginTop: '1rem' }}>Next 3 Periods:</p>
      <ul style={{ listStyleType: 'disc', paddingLeft: '2rem' }}>
        {data.forecast.map((value, index) => (
          <li key={index}>{Math.round(value)} units</li>
        ))}
      </ul>
    </div>
  );
}