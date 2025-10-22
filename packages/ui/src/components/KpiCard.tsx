/* eslint-disable @typescript-eslint/no-explicit-any */
// packages/ui/src/components/KpiCard.tsx
import React from "react";
import { Box, Typography } from "@mui/material";
import IconComponent from "./Icon"; // This import is fine

// --- NEW IMPORT ---
import MainCard from "../ui-component/cards/MainCard";

interface KpiCardProps {
  title: string;
  value: string;
  percentage: string;
  icon: string;
}

const KpiCard: React.FC<KpiCardProps> = ({ title, value, percentage, icon }) => {
  return (
    // Replace the outer Box with MainCard.
    // We set content={false} so the children are rendered directly
    // inside the Card, not a CardContent wrapper.
    <MainCard
      sx={{
        height: '100%' // We keep the height prop
      }}
      content={false} // This is the key
    >
      {/* This is the *exact same* layout from before. 
        We just removed the sx prop (backgroundColor, borderRadius, boxShadow) 
        from the outer Box, as MainCard now handles all of that. 
      */}
      <Box sx={{ padding: "1rem" }}> {/* We add padding back, as it was on the original Box */}
        <Box display="flex" justifyContent="space-between" alignItems="flex-start">
          <Box>
            <Typography variant="button" color="text" fontWeight="medium" textTransform="capitalize">
              {title}
            </Typography>
            <Typography variant="h5" fontWeight="bold">
              {value}
            </Typography>
          </Box>
          <Box
            sx={{
              width: "3rem",
              height: "3rem",
              borderRadius: "0.75rem",
              display: "grid",
              placeItems: "center",
              boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)",
              backgroundColor: "info.main",
              color: "white",
            }}
          >
            <IconComponent name={icon as any} size="small" color="white" />
          </Box>
        </Box>
        <Box sx={{ marginTop: "1rem", display: "block" }}>
          <Typography variant="button" color="text">
            <Typography variant="button" color="success" fontWeight="bold">
              {percentage}
            </Typography>
            &nbsp;than last week
          </Typography>
        </Box>
      </Box>
    </MainCard>
  );
};

export default KpiCard;