//packages/ui/src/components/WidgetLibrary/index.tsx
import React from "react";
import Drawer from "@mui/material/Drawer";
import MDBox from "../MDBox";
import MDTypography from "../MDTypography";
import IconButton from "@mui/material/IconButton";
import Icon from "@mui/material/Icon";
import TextField from "@mui/material/TextField";

interface WidgetLibraryProps {
  open: boolean;
  onClose: () => void;
}

// Placeholder component for a widget card in the library
const WidgetCardPlaceholder = ({ name }: { name: string }) => (
  <MDBox sx={{ width: "50%", padding: "0.5rem" }}>
    <MDBox
      sx={{
        border: "1px dashed #e0e0e0",
        borderRadius: "0.75rem",
        padding: "1rem",
        textAlign: "center",
        cursor: "pointer",
        "&:hover": { borderColor: "info.main" },
      }}
    >
      <MDTypography variant="h6" color="secondary">{name}</MDTypography>
    </MDBox>
  </MDBox>
);

const WidgetLibrary: React.FC<WidgetLibraryProps> = ({ open, onClose }) => {
  return (
    <Drawer anchor="right" open={open} onClose={onClose}>
      <MDBox width={{ xs: "100vw", sm: "400px" }} p={2}>
        <MDBox display="flex" justifyContent="space-between" alignItems="center">
          <MDTypography variant="h5">Widget Library</MDTypography>
          <IconButton onClick={onClose}>
            <Icon>close</Icon>
          </IconButton>
        </MDBox>
        <MDBox mt={3} mb={2}>
          <TextField fullWidth variant="outlined" placeholder="Search widgets..." />
        </MDBox>
        <MDBox sx={{ display: "flex", flexWrap: "wrap", margin: "-0.5rem" }}>
          <WidgetCardPlaceholder name="KPI Card" />
          <WidgetCardPlaceholder name="Cash Flow Chart" />
          <WidgetCardPlaceholder name="Inventory Health" />
          <WidgetCardPlaceholder name="Fulfillment Pipeline" />
          <WidgetCardPlaceholder name="Sales By Channel" />
          <WidgetCardPlaceholder name="Stockout Forecaster" />
        </MDBox>
      </MDBox>
    </Drawer>
  );
};

export default WidgetLibrary;