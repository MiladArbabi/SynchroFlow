// packages/ui/src/components/KpiCard.tsx
import React, { useState, useEffect } from 'react';
import axios from 'axios';

// --- Helper Functions ---
function formatValue(value: number, format: 'currency' | 'number' | 'percentage' | undefined): string {
  if (format === 'currency') {
    return value.toLocaleString('en-US', {
      style: 'currency',
      currency: 'USD',
    });
  }
  if (format === 'percentage') {
    // Format as a percentage with one decimal place, e.g., 42.5%
    return `${value.toFixed(1)}%`;
  }
  return value.toLocaleString('en-US');
}

// --- Component Props ---
interface KpiCardProps {
  title: string;
  // Props for "dumb" mode
  value?: string;
  isLoading?: boolean;
  // Props for "smart" mode
  dataUrl?: string;
  dataKey?: string;
  formatAs?: 'currency' | 'number' | 'percentage';
}

export const KpiCard: React.FC<KpiCardProps> = (props) => {
  // Internal state for smart-mode data fetching
  const [fetchedValue, setFetchedValue] = useState<number | null>(null);
  const [isFetching, setIsFetching] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    // Define the async function to fetch data
    const fetchData = async () => {
      setIsFetching(true);
      setError('');
      try {
        const response = await axios.get(props.dataUrl);
        if (response.data && response.data[props.dataKey!] !== undefined) {
          setFetchedValue(response.data[props.dataKey!]);
        } else {
          setError('Invalid data structure.');
        }
      } catch (_err) {
        setError('Failed to fetch data.');
      } finally {
        setIsFetching(false);
      }
    };

    fetchData();
  }, [props.dataUrl, props.dataKey]);

  // Decide whether to use internal state (smart) or passed-in props (dumb)
  const isLoading = props.dataUrl ? isFetching : props.isLoading ?? false;
  const finalValue = props.dataUrl ? (fetchedValue !== null ? formatValue(fetchedValue, props.formatAs) : '--') : props.value;

  // --- Render Logic ---
  let displayValue = '--';
  if (isLoading) {
    displayValue = 'Loading...';
  } else if (error) {
    displayValue = 'Error';
  } else if (finalValue !== undefined) {
    displayValue = finalValue;
  }
  
  return (
    <div className="bg-white p-6 border border-gray-200 rounded-lg">
      <h3 className="text-gray-600 text-sm font-medium">{props.title}</h3>
      <p className={`text-gray-800 text-3xl font-bold mt-2 ${error ? 'text-red-500' : ''}`}>
        {displayValue}
      </p>
    </div>
  );
};