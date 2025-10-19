// packages/ui/src/components/KpiCard.tsx
import { useState, useEffect } from "react";
import axios from "axios";
import MDBox from "./MDBox"; // We are keeping MDBox
import MDTypography from "./MDTypography"; // We are keeping MDTypography

// Helper to format values
function formatValue(value, format) {
  if (value === null || value === undefined) return "N/A";
  if (format === "currency") {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(value);
  }
  if (format === "percentage") {
    return `${value.toFixed(2)}%`;
  }
  return value.toLocaleString();
}

function KpiCard({ title, dataUrl, format, icon }) {
  const [data, setData] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      setIsLoading(true);
      try {
        const response = await axios.get(dataUrl);
        setData(response.data);
      } catch (error) {
        console.error(`Failed to fetch KPI data for ${title}:`, error);
      } finally {
        setIsLoading(false);
      }
    };
    fetchData();
  }, [dataUrl, title]);

  const displayValue = isLoading ? "Loading..." : formatValue(data?.value, format);

  return (
    <MDBox
      variant="gradient"
      bgColor="dark"
      color="white"
      borderRadius="lg"
      p={2}
      textAlign="center"
    >
      <MDTypography variant="h6" fontWeight="medium" color="white" textTransform="capitalize">
        {title}
      </MDTypography>
      <MDTypography variant="h4" fontWeight="bold" color="white">
        {displayValue}
      </MDTypography>
    </MDBox>
  );
}

export default KpiCard;