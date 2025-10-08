// packages/ui/src/App.tsx
import { Routes, Route } from 'react-router-dom';
import { LoginPage } from './LoginPage';

function App() {

  return (
    <div>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/" element={<h1>Welcome to the SynchroFlow Dashboard</h1>} />
      </Routes>
    </div>
  )
}

export default App
