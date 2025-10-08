// packages/ui/src/LoginPage.tsx
import React from 'react';

export function LoginPage() {
  return (
    <div style={{ padding: '2rem' }}>
      <h2 style={{ fontSize: '1.5rem', fontWeight: '600' }}>Sign In</h2>
      <form>
        <div style={{ marginTop: '1rem' }}>
          <label htmlFor="email">Email Address</label>
          <input
            id="email"
            name="email"
            type="email"
            required
            style={{
              display: 'block',
              width: '100%',
              marginTop: '0.25rem',
              border: '1px solid #D1D5DB',
              padding: '0.5rem',
            }}
          />
        </div>
      </form>
    </div>
  );
}