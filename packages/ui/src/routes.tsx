//packages/ui/src/routes.tsx
import { DashboardPage } from "./pages/DashboardPage";
import { LoginPage } from "./LoginPage";
import { ProductsPage } from "./pages/ProductsPage";
import { ProductIntelligencePage } from "./pages/ProductIntelligencePage";
import DataMapper from "./components/DataMapper/DataMapper";
import Icon from "@mui/material/Icon";

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
    type: "collapse",
    name: "Sign In",
    key: "sign-in",
    icon: "➡️", // Placeholder
    route: "/authentication/sign-in",
    component: <LoginPage />,
   },
];

export default routes;