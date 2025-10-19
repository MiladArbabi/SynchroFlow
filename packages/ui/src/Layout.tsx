// packages/ui/src/Layout.tsx
import { useState, useEffect } from "react";
import { useLocation, Outlet } from "react-router-dom";
import Sidenav from "./components/Sidenav";
import DashboardLayout from "./components/DashboardLayout";
import DashboardNavbar from "./components/DashboardNavbar";

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
        <DashboardLayout isSidenavOpen={isSidenavOpen}>
            <Sidenav
                brandName="SynchroFlow"
                routes={routes}
                isSidenavOpen={isSidenavOpen} // Pass state as a prop
            />
            <DashboardNavbar
                isSidenavOpen={isSidenavOpen} // Pass state as a prop
                handleSidenavToggle={handleSidenavToggle} // Pass handler as a prop
            />
            <Outlet /> {/* This will render the active page */}
        </DashboardLayout>
    );
}