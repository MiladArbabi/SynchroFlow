// packages/ui/src/components/KpiCard.tsx
import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { ComplexStatisticsCard } from './Cards/StatisticsCards/ComplexStatisticsCard';

// Helper function for formatting values
function formatValue(value: number, format?: 'currency' | 'number' | 'percentage'): string {
  if (format === 'currency') {
    return value.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
  }
  if (format === 'percentage') {
    return `${value.toFixed(1)}%`;
  }
  return value.toLocaleString('en-US');
}

// Define the props for our smart wrapper
interface KpiCardProps {
  title: string;
  dataUrl: string;
  dataKey: string;
  formatAs?: 'currency' | 'number' | 'percentage';
  icon: string;
  color?: "primary" | "secondary" | "info" | "success" | "warning" | "error" | "light" | "dark";
}

export const KpiCard: React.FC<KpiCardProps> = ({ title, dataUrl, dataKey, formatAs, icon, color }) => {
  const [value, setValue] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const fetchData = async () => {
      setIsLoading(true);
      setError('');
      try {
        const response = await axios.get(dataUrl);
        if (response.data && response.data[dataKey] !== undefined) {
          setValue(response.data[dataKey]);
        } else {
          setError('Invalid data.');
        }
      } catch (_err) {
        setError('Error');
      } finally {
        setIsLoading(false);
      }
    };

    fetchData();
  }, [dataUrl, dataKey]);

  let displayValue: string | number = '...';
  if (isLoading) {
    displayValue = '...';
  } else if (error) {
    displayValue = 'Error';
  } else if (value !== null) {
    displayValue = formatValue(value, formatAs);
  }

  return (
    <ComplexStatisticsCard
      title={title}
      count={displayValue}
      icon={icon}
      color={color}
    />
  );
};