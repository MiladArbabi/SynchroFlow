/* eslint-disable @typescript-eslint/no-explicit-any */
// packages/ui/src/components/KpiCard.tsx
import React from "react";
import { Box, Typography } from "@mui/material";
import { useTheme } from "@mui/material/styles"; // Import useTheme
import IconComponent from "./Icon";
import MainCard from "../ui-component/cards/MainCard";

// Import icons for percentage change
import { ArrowUpRight, ArrowDownRight } from "lucide-react";

// Define the palette color keys we'll accept
type KpiColor = 'primary' | 'secondary' | 'error' | 'warning' | 'success' | 'info';

interface KpiCardProps {
  title: string;
  value: string;
  /** The percentage change (e.g., 10.2 for +10.2%, -5.1 for -5.1%) */
  percentage: number;
  icon: string; // Lucide icon name
  /** The theme color to use for the icon box. Defaults to 'info'. */
  color?: KpiColor;
}

const KpiCard: React.FC<KpiCardProps> = ({
  title,
  value,
  percentage,
  icon,
  color = 'primary'
}) => {
  const theme = useTheme();

  // --- Logic for Percentage ---
  const isPositive = percentage >= 0;
  const percentageColor = isPositive ? theme.palette.success.main : theme.palette.error.main;
  const PercentageIcon = isPositive ? ArrowUpRight : ArrowDownRight;
  const percentageText = `${Math.abs(percentage).toFixed(1)}%`; // Format to 1 decimal place

  // --- Theme-Aware Icon Box Style ---
  const iconBoxSx = {
    width: "3rem",
    height: "3rem",
    borderRadius: "0.75rem", // 12px
    display: "grid",
    placeItems: "center",
    // Use theme shadows
    boxShadow: theme.shadows[2],
    // Use dynamic color from theme palette
    backgroundColor: theme.palette[color].main,
    // Use dynamic contrast text from theme palette
    color: theme.palette[color].contrastText,
  };

  return (
    <MainCard
      sx={{
        height: '100%',
        // Add hover shadow effect for the whole card
        '&:hover': {
           boxShadow: theme.shadows[5]
        }
      }}
      content={false}
    >
      <Box sx={{ p: 2.5 }}> {/* Use theme spacing multiplier */}
        <Box display="flex" justifyContent="space-between" alignItems="flex-start">
          <Box>
            {/* Use secondary text color for title for better hierarchy */}
            <Typography variant="body2" color="text.secondary" fontWeight="medium" textTransform="capitalize">
              {title}
            </Typography>
            <Typography variant="h5" fontWeight="bold" sx={{ mt: 0.5 }}> {/* Add small margin */}
              {value}
            </Typography>
          </Box>
          {/* Apply the theme-aware style */}
          <Box sx={iconBoxSx}>
            {/* Icon color now inherited from parent Box */}
            <IconComponent name={icon as any} size="small" color="inherit" />
          </Box>
        </Box>
        <Box sx={{ mt: 2, display: 'flex', alignItems: 'center' }}> {/* Use flex for icon alignment */}
          <PercentageIcon
            size="1rem" // 16px
            color={percentageColor}
            style={{ marginRight: theme.spacing(0.5) }} // 4px margin
          />
          <Typography variant="body2" color="text.secondary">
            <Typography
              component="span" // Render as span
              variant="body2"
              color={percentageColor} // Use dynamic color
              fontWeight="bold"
            >
              {percentageText}
            </Typography>
            &nbsp;than last week
          </Typography>
        </Box>
      </Box>
    </MainCard>
  );
};

export default KpiCard;