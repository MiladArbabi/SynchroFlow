// packages/ui/src/App.tsx
import React from "react";
import { Routes, Route, Navigate, Outlet } from "react-router-dom";
import { ThemeProvider } from "@mui/material/styles";
import CssBaseline from "@mui/material/CssBaseline";
import AppLayout from "./layouts/AppLayout";
import routes from "./routes";
import { UserProvider } from "./contexts/UserContext";

import { createTheme } from "@mui/material/styles";
const spikeTheme = createTheme();

export default function App() {
  return (
    <UserProvider>
      <ThemeProvider theme={spikeTheme}>
        <CssBaseline />
        <Routes>
        {/* Render the sign-in route standalone */}
          <Route path="/authentication/sign-in" element={routes.find(r => r.key === 'sign-in')?.component} />
          {/* All other routes are nested inside the AppLayout */}
          <Route element={<AppLayout><Outlet /></AppLayout>}>
            {routes.map((route) =>
              route.key !== "sign-in" ? (
                <Route path={route.route} element={route.component} key={route.key} />
              ) : null
            )}
          </Route>

          {/* A default redirect to the dashboard */}
          <Route path="*" element={<Navigate to="/dashboard" />} />
        </Routes>
      </ThemeProvider>
    </UserProvider>
  );
}