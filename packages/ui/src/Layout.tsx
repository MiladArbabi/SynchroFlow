// packages/ui/src/Layout.tsx
import React from 'react';
import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { Header } from './Header';

export function Layout() {
  return (
    <div style={{ display: 'flex', minHeight: '100vh', backgroundColor: '#F0F2F5' }}>
      <Sidebar />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        <Header />
        <main style={{ flex: 1, padding: '2rem' }}>
          {/* Child routes will render here */}
          <Outlet />
        </main>
      </div>
    </div>
  );
}