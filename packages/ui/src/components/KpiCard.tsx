/* eslint-disable @typescript-eslint/no-explicit-any */
// packages/ui/src/components/KpiCard.tsx
import React from "react";
import { Box } from "@mui/material";
import {Typography} from "@mui/material";
import IconComponent from "./Icon";

interface KpiCardProps {
  title: string;
  value: string;
  percentage: string;
  icon: string;
 }

const KpiCard: React.FC<KpiCardProps> = ({ title, value, percentage, icon }) => {
  return (
    <Box
      sx={{
        backgroundColor: "white",
        borderRadius: "0.75rem",
        padding: "1rem",
        boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)",
        height: '100%'
      }}
    >
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
          color="white"
          bgColor="info"
          sx={{
            width: "3rem",
            height: "3rem",
            borderRadius: "0.75rem",
            display: "grid",
            placeItems: "center",
            boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)",
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
  );
}

export default KpiCard;