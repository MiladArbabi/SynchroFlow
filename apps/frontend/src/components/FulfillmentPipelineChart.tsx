/* eslint-disable @typescript-eslint/no-explicit-any */
// apps/frontend/src/components/FulfillmentPipelineChart.tsx
import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { Bar } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend,
} from 'chart.js';
import { Box } from '@mui/material';
import {Typography} from '@mui/material';
import Card from "@mui/material/Card";

// Register Chart.js components
ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend
);

// Define the shape of our API response
interface PipelineData {
  processing: number;
  in_transit: number;
  delivered: number;
}

export const FulfillmentPipelineChart: React.FC = () => {
  const [chartData, setChartData] = useState<any>({
    labels: [],
    datasets: [],
  });
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      setIsLoading(true);
      try {
        const response = await axios.get<PipelineData>('/api/v1/analytics/fulfillment-pipeline?shop_id=1');
        const data = response.data;

        setChartData({
          labels: ['Processing', 'In Transit', 'Delivered'],
          datasets: [
            {
              label: 'Order Count',
              data: [data.processing, data.in_transit, data.delivered],
              backgroundColor: 'rgba(75, 192, 192, 0.6)',
              borderColor: 'rgba(75, 192, 192, 1)',
              borderWidth: 1,
            },
          ],
        });
      } catch (error) {
        console.error("Failed to fetch fulfillment data:", error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchData();
  }, []);

  const options = {
    responsive: true,
    plugins: {
      legend: {
        display: false,
      },
    },
    scales: {
        y: {
            beginAtZero: true,
        }
    }
  };

  return (
    <Card>
        <Box p={2}>
            <Typography variant="h6">Fulfillment Pipeline</Typography>
        </Box>
        <Box p={2}>
            {isLoading ? (
                <Typography>Loading chart...</Typography>
            ) : (
                <Bar options={options} data={chartData} />
            )}
        </Box>
    </Card>
  );
};