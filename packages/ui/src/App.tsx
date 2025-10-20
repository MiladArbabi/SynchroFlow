// packages/ui/src/App.tsx
import { Routes, Route, Navigate } from "react-router-dom";
import { ThemeProvider } from "@mui/material/styles";
import CssBaseline from "@mui/material/CssBaseline";

// NOTE: The theme files were not in the directory listing, 
// so we are temporarily creating a default theme object for the spike.
import { createTheme } from "@mui/material/styles";
const spikeTheme = createTheme();

// Our new spike layout for testing. The path is now correct.
import SpikeResizableLayout from "./layouts/SpikeLayout";

export default function App() {
  return (
    // We use the basic theme here. We will restore your full theme logic later.
    <ThemeProvider theme={spikeTheme}>
      <CssBaseline />
      <Routes>
        {/* 1. The ONLY route for this spike is the layout evaluation page. */}
        <Route path="/spike/resizable-layout" element={<SpikeResizableLayout />} />

        {/* 2. All other paths redirect to our test page for now. */}
        <Route path="*" element={<Navigate to="/spike/resizable-layout" />} />
      </Routes>
    </ThemeProvider>
  );
}