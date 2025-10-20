//packages/ui/src/components/WidgetLibrary/index.tsx
import React from "react";
import Drawer from "@mui/material/Drawer";
import { WIDGET_REGISTRY, WidgetConfig } from "../../widgets/widgetRegistry";
import MDBox from "../MDBox";
import MDTypography from "../MDTypography";
import IconButton from "@mui/material/IconButton";
import Icon from "@mui/material/Icon";
import TextField from "@mui/material/TextField";

interface WidgetLibraryProps {
  open: boolean;
  onClose: () => void;
  onAddWidget: (widgetId: string) => void;
}

// Placeholder component for a widget card in the library
const WidgetCard = ({ widget, onAdd }: { widget: WidgetConfig; onAdd: () => void }) => (
  <MDBox sx={{ width: "50%", padding: "0.5rem" }}>
  {/* FIX: Wrap the card in a button to ensure click events are handled */}
    <MDBox
      onClick={() => {
        console.log(`[DEBUG] WidgetCard clicked: ${widget.name}`);
        onAdd();
      }}
      sx={{
        border: "1px dashed #e0e0e0",
        borderRadius: "0.75rem",
        padding: "1rem",
        textAlign: "center",
        cursor: "pointer",
        "&:hover": { borderColor: "info.main" },
        position: "relative",
        zIndex: 1,
      }}
    >
   <MDTypography variant="h6" color="secondary">
        {widget.name}
      </MDTypography>
    </MDBox> 
  </MDBox>
);

const WidgetLibrary: React.FC<WidgetLibraryProps> = ({ open, onClose, onAddWidget }) => {
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
          {Object.values(WIDGET_REGISTRY).map((widget) => (
            <WidgetCard 
            key={widget.id} 
            widget={widget} 
            onAdd={() => {
              console.log(`[DEBUG] Forwarding onAdd for: ${widget.id}`);
              onAddWidget(widget.id);
            }} />
          ))}
        </MDBox>
      </MDBox>
    </Drawer>
  );
};

export default WidgetLibrary;