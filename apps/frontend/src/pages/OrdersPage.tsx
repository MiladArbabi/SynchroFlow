/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unused-vars */
import React, { useEffect, JSX } from 'react';
import { useNavigate } from 'react-router-dom';

// Temporary compatibility shim: redirect to module-provided route
export default function OrdersPage(): JSX.Element | null {
  const navigate = useNavigate();
  useEffect(() => {
    // Prefer host navigation hook if mounted by module system
    // (falls back to react-router navigate)
    const hostNavigate = (window as any)._lasyncroNavigate;
    if (typeof hostNavigate === 'function') {
      hostNavigate('/orders');
    } else {
      navigate('/orders', { replace: true });
    }
  }, [navigate]);

  // Lightweight placeholder while redirect happens
  return null;
}