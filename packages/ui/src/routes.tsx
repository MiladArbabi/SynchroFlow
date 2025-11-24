// packages/ui/src/routes.tsx
import React from "react";
import { DashboardPage } from "./pages/DashboardPage";
import LoginPage from "./pages/authentication/LoginPage";
import RegisterPage from "./pages/authentication/RegisterPage";
import { ProductsPage } from "./pages/ProductsPage";
import { ProductIntelligencePage } from "./pages/ProductIntelligencePage";
import DataMapper from "./components/DataMapper/DataMapper";
import Order360Page from "./pages/Order360Page";
import OrdersPage from "./pages/OrdersPage";
import EchoHubPage from "./pages/EchoHubPage";
import Customer360Page from "./pages/Customer360Page";
import CustomersPage from "./pages/CustomersPage";
import AccountSettingsPage from "./pages/AccountSettingsPage";
import { Product360Page } from "./pages/Product360Page";
import AnalyticsPage from "./pages/AnalyticsPage";
import FinancesPage from "./pages/FinancesPage";

const routes = [
  {
    type: "collapse",
    name: "Dashboard",
    key: "dashboard",
    icon: "🏠",
    route: "/dashboard",
    component: <DashboardPage children={<></>} handleSidenavToggle={() => {}} />,
  },
  {
   type: "collapse",
   name: "Analytics",
   key: "analytics",
   icon: "📈",
   route: "/analytics",
   component: <AnalyticsPage />,
 },
 {
   type: "collapse",
   name: "Finances",
   key: "finances",
   icon: "💰",
   route: "/finances",
   component: <FinancesPage />,
 },
  {
    type: "route",
    name: "Order Details",
    key: "order-details", 
    route: "/orders/:id", // More specific route comes FIRST
    component: <Order360Page />,
  },
  {
    type: "collapse",
    name: "Orders",
    key: "orders",
    route: "/orders", // General route comes AFTER specific route
    component: <OrdersPage />,
  },
  {
    type: "route",
    name: "Customer Details", 
    key: "customer-details",
    route: "/customers/:id", // Specific first
    component: <Customer360Page />,
  },
  {
    type: "collapse",
    name: "Customers",
    key: "customers",
    icon: "👥",
    route: "/customers",
    component: <CustomersPage />,
  },
      {
    type: "route",
    name: "Product Details", 
    key: "product-details",
    route: "/products/:id",
    component: <Product360Page />,
  },
  {
    type: "collapse",
    name: "Products",
    key: "products",
    icon: "📦",
    route: "/products",
    component: <ProductsPage />,
  },
  {
    type: "collapse",
    name: "Echo Inbox",
    key: "echo-hub",
    icon: "💬",
    route: "/echo-hub",
    component: <EchoHubPage />,
  },
  {
    type: "collapse",
    name: "Data Mapper",
    key: "data-mapper",
    icon: "🔗",
    route: "/data-mapper", 
    component: <DataMapper />,
  },
  {
    type: "collapse",
    name: "Product Intelligence",
    key: "product-intelligence",
    icon: "💡",
    route: "/product-intelligence",
    component: <ProductIntelligencePage />,
  },
  {
    type: "route",
    name: "Account Settings",
    key: "account-settings",
    route: "/account/settings",
    component: <AccountSettingsPage />,
  },
  {
    type: "route",
    name: "Login",
    key: "login",
    route: "/login",
    component: <LoginPage />,
  },
  {
    type: "route",
    name: "Register",
    key: "register",
    route: "/register",
    component: <RegisterPage />,
  },
];

export default routes;