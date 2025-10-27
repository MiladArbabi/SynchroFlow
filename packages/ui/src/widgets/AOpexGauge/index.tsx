// packages/ui/src/widgets/AOpexGauge/index.tsx
import React, { useMemo } from 'react';
import ReactApexChart from 'react-apexcharts';
import { useTheme } from '@mui/material/styles';
import { Box, Stack, Typography } from '@mui/material';
import MainCard from 'ui-component/cards/MainCard';
import { ApexOptions } from 'apexcharts';

interface AOpexGaugeProps {
  title: string;
  value: number;
  target: number;
}

/**
 * Formats a number as USD currency.
 */
const formatCurrency = (value: number) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
    minimumFractionDigits: 0,
  }).format(value);

/**
 * The A-Opex Gauge Widget: Displays opex savings as a radial gauge.
 */
const AOpexGauge: React.FC<AOpexGaugeProps> = ({ title, value, target }) => {
  const theme = useTheme();

  // Calculate percentage
  const percentage = Math.round((value / target) * 100);

  // Memoize chart options
  const chartOptions: ApexOptions = useMemo(() => ({
    chart: {
      type: 'radialBar',
      sparkline: {
        enabled: true,
      },
    },
    plotOptions: {
      radialBar: {
        hollow: {
          size: '70%',
        },
        track: {
          background: theme.palette.grey[300],
          margin: 10,
        },
        dataLabels: {
          name: {
            show: false,
          },
          value: {
            show: true,
            fontSize: '1.5rem',
            fontWeight: 600,
            offsetY: 8,
            color: theme.palette.text.primary,
            formatter: (val) => `${val}%`,
          },
        },
      },
    },
    labels: ['Progress'],
    colors: [theme.palette.primary.main],
    stroke: {
      lineCap: 'round',
    },
  }), [theme]);

  return (
    <MainCard title={title}>
      <Stack 
        spacing={2} 
        alignItems="center" 
        justifyContent="center"
        sx={{ mt: 2 }}
      >
        {/* The Gauge */}
        <ReactApexChart
          options={chartOptions}
          series={[percentage]}
          type="radialBar"
          height={180}
        />
        
        {/* The Value */}
        <Box sx={{ mt: -3 }}>
          <Typography 
            variant="h2" 
            color="primary"
            data-testid="aopex-value"
          >
            {formatCurrency(value)}
          </Typography>
        </Box>

        {/* The Target */}
        <Typography variant="body2" color="textSecondary">
          Target: {formatCurrency(target)}
        </Typography>
      </Stack>
    </MainCard>
  );
};

export default AOpexGauge;