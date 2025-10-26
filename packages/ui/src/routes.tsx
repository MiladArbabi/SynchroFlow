//packages/ui/src/routes.tsx
import { DashboardPage } from "./pages/DashboardPage";
import { LoginPage } from "./LoginPage";
import { ProductsPage } from "./pages/ProductsPage";
import { ProductIntelligencePage } from "./pages/ProductIntelligencePage";
import DataMapper from "./components/DataMapper/DataMapper";
import Order360Page from "./pages/Order360Page";
import OrdersPage from "./pages/OrdersPage";
import EchoHubPage from "./pages/EchoHubPage";
import Customer360Page from "./pages/Customer360Page";
import CustomersPage from "./pages/CustomersPage";

const routes = [
  {
    type: "collapse",
    name: "Dashboard",
    key: "dashboard",
    icon: "🏠",
    route: "/dashboard",
    component: <DashboardPage />,
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
      type: "collapse", // Keep as collapse if it's in the Sidenav
      name: "Orders",   // Match Sidenav item title
      key: "orders",
      route: "/orders", // The main list view route
      component: <OrdersPage />,
  },
  {
    type: "collapse", // Show in Sidenav
    name: "Customers", // Match Sidenav item title
    key: "customers",
    icon: "👥", // Placeholder icon
    route: "/customers", // The main list view route
    component: <CustomersPage />,
  },
  {
    type: "collapse", // Show in Sidenav
    name: "Echo Inbox",
    key: "echo-hub",
    icon: "💬", // Placeholder icon
    route: "/echo-hub",
    component: <EchoHubPage />,
  },
  {
    type: "route",
    name: "Customer Details",
    key: "customer-details",
    route: "/customers/:id", // Route with parameter
    component: <Customer360Page />,
  },
  {
    type: "collapse",
    name: "Data Mapper",
    key: "data-mapper",
    icon: "🔗", // Placeholder
    route: "/data-mapper", 
    component: <DataMapper />,
  },
  {
    type: "collapse",
    name: "Product Intelligence",
    key: "product-intelligence",
    icon: "💡", // Placeholder
    route: "/product-intelligence",
    component: <ProductIntelligencePage />,
  },
  {
    type: "route", // Use a different type if not for Sidenav display
    name: "Order Details",
    key: "order-details",
    route: "/orders/:id", // Use a parameter for the order ID
    component: <Order360Page />,
  },
  {
    type: "collapse",
    name: "Sign In",
    key: "sign-in",
    icon: "➡️", // Placeholder
    route: "/authentication/sign-in",
    component: <LoginPage />,
   },
];

export default routes;