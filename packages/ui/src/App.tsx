// packages/ui/src/App.tsx
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { LoginPage } from './LoginPage';
import Layout from './Layout';
import routes from './routes';
import { JSX, useEffect } from 'react';

// Define a type for our route objects to avoid using 'any'
interface RouteType {
  type: string;
  name: string;
  key: string;
  icon: JSX.Element;
  route: string;
  component: JSX.Element;
  collapse?: RouteType[];
}

function App() {
  const { pathname } = useLocation();

  // Setting the page layout for the sidenav
  // This logic is from the template and ensures the correct layout is set in the context
  useEffect(() => {
    // Placeholder for layout context logic if needed in the future
  }, [pathname]);

  const getRoutes = (allRoutes: RouteType[]) =>
    allRoutes.map((route) => {
      if (route.collapse) {
        return getRoutes(route.collapse);
      }

      if (route.route) {
        return <Route path={route.route} element={route.component} key={route.key} />;
      }

      return null;
    });

  return (
      <Routes>
        {/* Public Routes */}
        <Route path="/login" element={<LoginPage />} />

        {/* Protected Routes */}
        <Route element={<Layout />}>
          {getRoutes(routes)}
          <Route path="*" element={<Navigate to="/dashboard" />} />
        </Route>

        {/* Default route redirects to dashboard */}
        <Route path="/" element={<Navigate to="/dashboard" />} />
      </Routes>
  )
}

export default App