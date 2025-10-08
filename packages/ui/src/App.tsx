// packages/ui/src/App.tsx
import { Routes, Route } from 'react-router-dom';
import { LoginPage } from './LoginPage';
import { ProductIntelligencePage } from './pages/ProductIntelligencePage';
import { Layout } from './Layout';

function App() {

  return (
    <div>
      <Routes>
        {/* Routes inside the main application shell */}
        <Route path="/" element={<Layout />}>
          <Route index element={<h1>Welcome to the FinOps Command Center</h1>} />
          <Route path="/products" element={<ProductIntelligencePage />} />
        </Route>
        <Route path="/login" element={<LoginPage />} />
      </Routes>
    </div>
  )
}

export default App
