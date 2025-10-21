/* eslint-disable @typescript-eslint/no-explicit-any */
// packages/ui/src/components/KpiCard.tsx
import React from "react";
import MDBox from "./MDBox"; // We are keeping MDBox
import MDTypography from "./MDTypography"; // We are keeping MDTypography
import IconComponent from "./Icon";

interface KpiCardProps {
  title: string;
  value: string;
  percentage: string;
  icon: string;
 }

const KpiCard: React.FC<KpiCardProps> = ({ title, value, percentage, icon }) => {
  return (
    <MDBox
      sx={{
        backgroundColor: "white",
        borderRadius: "0.75rem",
        padding: "1rem",
        boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)",
        height: '100%'
      }}
    >
      <MDBox display="flex" justifyContent="space-between" alignItems="flex-start">
        <MDBox>
          <MDTypography variant="button" color="text" fontWeight="medium" textTransform="capitalize">
            {title}
          </MDTypography>
          <MDTypography variant="h5" fontWeight="bold">
            {value}
          </MDTypography>
        </MDBox>
        <MDBox
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
        </MDBox>
      </MDBox>
      <MDBox sx={{ marginTop: "1rem", display: "block" }}>
        <MDTypography variant="button" color="text">
          <MDTypography variant="button" color="success" fontWeight="bold">
          {percentage}
          </MDTypography>
          &nbsp;than last week
        </MDTypography>
      </MDBox>
    </MDBox>
  );
}

export default KpiCard;