// packages/ui/src/App.tsx
import { Routes, Route } from 'react-router-dom';
import { LoginPage } from './LoginPage';
import { ProductIntelligencePage } from './pages/ProductIntelligencePage';
import { DashboardPage } from './pages/DashboardPage';
import { Layout } from './Layout';

function App() {

  return (
    <div>
      <Routes>
        {/* Routes inside the main application shell */}
        <Route path="/" element={<Layout />}>
          <Route index element={<DashboardPage />} />
          <Route path="product-intelligence" element={<ProductIntelligencePage />} />
          {/* Add other nested routes here */}
        </Route>
        <Route path="/login" element={<LoginPage />} />
      </Routes>
    </div>
  )
}

export default App
