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
    icon: <Icon fontSize="small">dashboard</Icon>,
    route: "/dashboard",
    component: <DashboardPage />,
  },
  {
    type: "collapse",
    name: "Products",
    key: "products",
    icon: <Icon fontSize="small">inventory</Icon>,
    route: "/products",
    component: <ProductsPage />,
  },
  {
    type: "collapse",
    name: "Data Mapper",
    key: "data-mapper",
    icon: <Icon fontSize="small">schema</Icon>, // A more descriptive icon
    route: "/data-mapper", 
    component: <DataMapper />,
  },
  {
    type: "collapse",
    name: "Product Intelligence",
    key: "product-intelligence",
    icon: <Icon fontSize="small">transform</Icon>,
    route: "/product-intelligence",
    component: <ProductIntelligencePage />,
  },
  {
    type: "collapse",
    name: "Sign In",
    key: "sign-in",
    icon: <Icon fontSize="small">login</Icon>,
    route: "/authentication/sign-in",
    component: <LoginPage />,
   },
];

export default routes;