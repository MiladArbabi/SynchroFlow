// packages/ui/src/widgets/CashFlowWidget.tsx
import React from 'react';
import ReactApexChart from 'react-apexcharts'; // The chart component
import { useTheme } from '@mui/material/styles';
import { Box, Typography, Stack } from '@mui/material';
import MainCard from 'ui-component/cards/MainCard';
import { ApexOptions } from 'apexcharts'; // Import chart options type

// Mock Data for the chart
const mockChartData = {
  categories: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
  series: [
    {
      name: 'Cash In',
      data: [35, 41, 36, 26, 45, 48, 52, 53, 41, 44, 46, 48]
    },
    {
      name: 'Cash Out',
      data: [22, 30, 28, 33, 28, 32, 38, 40, 30, 33, 35, 30]
    }
  ]
};

// ==============================|| CASH FLOW WIDGET ||============================== //

const CashFlowWidget: React.FC = () => {
  const theme = useTheme();

  // --- Theme-Aware Chart Options ---
  const chartOptions: ApexOptions = {
    chart: {
      type: 'area',
      height: 300,
      fontFamily: theme.typography.fontFamily,
      toolbar: { show: false }, // Hide the toolbar
      zoom: { enabled: false },
    },
    colors: [theme.palette.primary.main, theme.palette.error.main], // Use theme colors!
    dataLabels: { enabled: false },
    stroke: {
        curve: 'smooth',
        width: 2
    },
    fill: {
        type: 'gradient',
        gradient: {
            shadeIntensity: 1,
            opacityFrom: 0.4,
            opacityTo: 0.1,
            stops: [0, 90, 100]
        }
    },
    grid: {
      borderColor: theme.palette.divider, // Use theme divider color
      strokeDashArray: 2,
    },
    xaxis: {
      categories: mockChartData.categories,
      axisBorder: { show: false },
      axisTicks: { show: false },
      labels: {
        style: {
          colors: theme.palette.text.secondary, // Use theme text color
        }
      }
    },
    yaxis: {
      labels: {
        style: {
          colors: theme.palette.text.secondary, // Use theme text color
        },
        formatter: (value) => `$${value}k` // Format as thousands
      },
    },
    tooltip: {
      theme: theme.palette.mode, // Match tooltip to theme mode
      x: { format: 'MMM' },
      y: { formatter: (val) => `$${val}k` }
    },
    legend: {
        show: true,
        position: 'top',
        horizontalAlign: 'right',
        labels: {
            colors: theme.palette.text.secondary, // Use theme text color
        },
        markers: {
             fillColors: [theme.palette.primary.main, theme.palette.error.main]
        }
    }
  };

  return (
    // Wrap the chart in a MainCard
    <MainCard
        title="Cash Flow Forecast"
        // secondary={<Button>Monthly</Button>} // Example: Add secondary action
        sx={{ height: '100%' }}
        content={false} // Remove default padding
    >
        <Box sx={{ p: 2.5, pb: 1 }}> {/* Add custom padding */}
            {/* You can add summary stats here */}
            <Stack spacing={1}>
                <Typography variant="h3" color="text.primary">$45,890</Typography>
                <Typography variant="body2" color="text.secondary">Net EOM Balance (Est.)</Typography>
            </Stack>
        </Box>
        {/* Render the chart */}
        <ReactApexChart
            options={chartOptions}
            series={mockChartData.series}
            type="area"
            height={300} // Adjust height as needed
        />
    </MainCard>
  );
};

export default CashFlowWidget;