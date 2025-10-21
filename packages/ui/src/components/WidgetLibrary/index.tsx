//packages/ui/src/components/WidgetLibrary/index.tsx
import React from "react";
import Drawer from "@mui/material/Drawer";
import { WIDGET_REGISTRY, WidgetConfig, PlanLevel } from "../../widgets/widgetRegistry";
import { Box } from "@mui/material";
import {Typography} from "@mui/material";
import IconButton from "@mui/material/IconButton";
import Icon from "@mui/material/Icon";
import TextField from "@mui/material/TextField";
import LockIcon from "@mui/icons-material/Lock";

interface WidgetLibraryProps {
  open: boolean;
  onClose: () => void;
  onAddWidget: (widgetId: string) => void;
  currentPlan: PlanLevel;
}

// Placeholder component for a widget card in the library
// Widget card component, now aware of locked state
const WidgetCard = ({
  widget,
  onAdd,
  isLocked,
}: {
  widget: WidgetConfig;
  onAdd: () => void;
  isLocked: boolean;
}) => (
  <Box sx={{ width: "50%", padding: "0.5rem" }}>
  {/* FIX: Wrap the card in a button to ensure click events are handled */}
    <Box
      onClick={isLocked ? () => alert(`Requires ${widget.requiredPlan} plan`) : onAdd} // Placeholder alert for locked state
      sx={{
        border: "1px dashed #e0e0e0",
        borderRadius: "0.75rem",
        padding: "1rem",
        textAlign: "center",
        cursor: isLocked ? "not-allowed" : "pointer",
        opacity: isLocked ? 0.5 : 1, // Grey out if locked
        position: "relative", // Needed for icon positioning
        "&:hover": {
          borderColor: isLocked ? "#e0e0e0" : "info.main", // Only change border if not locked
        },
        zIndex: 1,
      }}
    >
    {isLocked && (
        <LockIcon
          fontSize="small"
          sx={{
            position: "absolute",
            top: 8,
            right: 8,
            color: "text.disabled",
          }}
        />
      )}
   <Typography variant="h6" color="secondary">
        {widget.name}
      </Typography>
    </Box> 
  </Box>
);

const WidgetLibrary: React.FC<WidgetLibraryProps> = ({ open, onClose, onAddWidget, currentPlan }) => {
  // Function to determine if a widget should be locked based on plan
  const isWidgetLocked = (widgetPlan: PlanLevel): boolean => {
    const planHierarchy: Record<PlanLevel, number> = {
      Ignition: 1,
      Clarity: 2,
      Autonomous: 3,
    };
    return planHierarchy[currentPlan] < planHierarchy[widgetPlan];
  };

  return (
    <Drawer anchor="right" open={open} onClose={onClose}>
      <Box width={{ xs: "100vw", sm: "400px" }} p={2}>
        <Box display="flex" justifyContent="space-between" alignItems="center">
          <Typography variant="h5">Widget Library</Typography>
          <IconButton onClick={onClose}>
            <Icon>x</Icon>
          </IconButton>
        </Box>
        <Box mt={3} mb={2}>
          <TextField fullWidth variant="outlined" placeholder="Search widgets..." />
        </Box>
        <Box sx={{ display: "flex", flexWrap: "wrap", margin: "-0.5rem" }}>
          {Object.values(WIDGET_REGISTRY).map((widget) => {
            const locked = isWidgetLocked(widget.requiredPlan);
            return (
              <WidgetCard
                key={widget.id}
                widget={widget}
                onAdd={() => onAddWidget(widget.id)}
                isLocked={locked}
              />
            );
          })}
        </Box>
      </Box>
    </Drawer>
  );
};

export default WidgetLibrary;