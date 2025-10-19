// packages/ui/src/Layout.tsx
import { useState, useEffect } from "react";
import { useLocation, Outlet } from "react-router-dom";
import Sidenav from "./components/Sidenav";
import DashboardLayout from "./components/DashboardLayout";
import Box from "@mui/material/Box";

// You will need to define your routes here.
// This is just a placeholder example.
const routes = [
    { type: "title", title: "Main", key: "title-main" },
    { type: "collapse", name: "Dashboard", key: "dashboard", href: "/dashboard", icon: <div>D</div> },
    { type: "collapse", name: "Products", key: "products", href: "/products", icon: <div>P</div> },
]as const;

export default function Layout() {
    const [isSidenavOpen, setSidenavOpen] = useState(true);
    const { pathname } = useLocation();

    const handleSidenavToggle = () => setSidenavOpen(!isSidenavOpen);

    // Set the document layout for the main page
    useEffect(() => {
        document.body.setAttribute("layout", "dashboard");
    }, [pathname]);

    return (
        <Box sx={{ display: 'flex' }}>
            <Sidenav
                brandName="SynchroFlow"
                routes={routes}
                isSidenavOpen={isSidenavOpen}
            />
            <DashboardLayout handleSidenavToggle={handleSidenavToggle}>
                <Outlet /> {/* This will render the active page */}
            </DashboardLayout>
        </Box>
    );
}