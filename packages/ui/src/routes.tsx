//packages/ui/src/routes.tsx
import { DashboardPage } from "./pages/DashboardPage";
import { LoginPage } from "./LoginPage";
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
     name: "Sign In",
     key: "sign-in",
     icon: <Icon fontSize="small">login</Icon>,
     route: "/authentication/sign-in",
    component: <LoginPage />,
   },
];

export default routes;