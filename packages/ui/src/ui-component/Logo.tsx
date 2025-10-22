// packages/ui/src/ui-component/Logo.tsx
import React from 'react';

// ==============================|| LOGO SVG ||============================== //

// Define the component type using React.FC (Functional Component)
const Logo: React.FC = () => {
  // We'll keep the SVG simple for now. Replace with your actual SVG later.
  return (
    <svg width="100" height="30" viewBox="0 0 100 30" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect width="100" height="30" rx="4" fill="#673ab7"/>
      <text x="50%" y="50%" dominantBaseline="middle" textAnchor="middle" fill="white" fontSize="14" fontWeight="bold">
        LOGO
      </text>
    </svg>
  );
};

export default Logo;