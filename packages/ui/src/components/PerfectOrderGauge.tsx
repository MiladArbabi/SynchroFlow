// packages/ui/src/components/PerfectOrderGauge.tsx
import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { Doughnut } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  ArcElement,
  Tooltip,
  Legend,
} from 'chart.js';
import { Box } from '@mui/material';
import {Typography} from '@mui/material';
import Card from "@mui/material/Card";

// Register the necessary Chart.js components
ChartJS.register(ArcElement, Tooltip, Legend);

export const PerfectOrderGauge: React.FC = () => {
  const [percentage, setPercentage] = useState(0);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      setIsLoading(true);
      try {
        const response = await axios.get<{ perfect_order_percentage: number }>('/api/v1/analytics/perfect-order-percentage?shop_id=1');
        setPercentage(response.data.perfect_order_percentage);
      } catch (error) {
        console.error("Failed to fetch perfect order percentage:", error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchData();
  }, []);

  const data = {
    datasets: [
      {
        data: [percentage, 100 - percentage],
        backgroundColor: ['rgba(75, 192, 192, 0.6)', 'rgba(220, 220, 220, 0.6)'],
        borderColor: ['rgba(75, 192, 192, 1)', 'rgba(220, 220, 220, 1)'],
        borderWidth: 1,
        circumference: 180, // Makes it a semi-circle
        rotation: -90,      // Starts the gauge at the left
      },
    ],
  };

  const options = {
    responsive: true,
    plugins: {
      legend: { display: false },
      tooltip: { enabled: false },
    },
    cutout: '80%', // Creates the doughnut hole
  };

  return (
    <Card>
      <Box p={2} textAlign="center">
        <Typography variant="h6">Perfect Order %</Typography>
        <Box sx={{ position: 'relative', height: '150px', mt: 2 }}>
          {isLoading ? (
            <Typography>Loading...</Typography>
          ) : (
            <>
              <Doughnut data={data} options={options} />
              <Box
                sx={{
                  position: 'absolute',
                  top: '70%',
                  left: '50%',
                  transform: 'translate(-50%, -50%)',
                }}
              >
                <Typography variant="h4" fontWeight="bold">
                  {`${percentage.toFixed(1)}%`}
                </Typography>
              </Box>
            </>
          )}
        </Box>
      </Box>
    </Card>
  );
};