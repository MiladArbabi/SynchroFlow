// packages/ui/src/Sidebar.tsx
import React from 'react';
import { Link } from 'react-router-dom';

export function Sidebar() {
  return (
    <aside style={{ width: '250px', backgroundColor: '#434D5B', color: 'white', padding: '1rem' }}>
      <h1 style={{ fontSize: '1.5rem', fontWeight: 'bold' }}>SynchroFlow</h1>
      <nav style={{ marginTop: '2rem' }}>
        <ul>
          <li>
            <Link to="/" style={{ color: 'white', textDecoration: 'none' }}>Dashboard</Link>
          </li>
          <li style={{ marginTop: '1rem' }}>
            {/* This is the link our test is looking for */}
            <Link to="/products" style={{ color: 'white', textDecoration: 'none' }}>Products</Link>
          </li>
        </ul>
      </nav>
    </aside>
  );
}