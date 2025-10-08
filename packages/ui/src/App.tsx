// packages/ui/src/App.tsx
import { Routes, Route } from 'react-router-dom';
import { LoginPage } from './LoginPage';
import { Layout } from './Layout';

function App() {

  return (
    <div>
      <Routes>
        {/* Routes inside the main application shell */}
        <Route path="/" element={<Layout />}>
          <Route index element={<h1>Dashboard</h1>} />
          {/* Add other main app routes here later, e.g., for Inventory */}
        </Route>
        <Route path="/login" element={<LoginPage />} />
      </Routes>
    </div>
  )
}

export default App
