// apps/frontend/src/ui-component/MasterPanel/index.tsx
import React, { ReactNode } from 'react';

// Import the Berry MainCard component
import MainCard from 'ui-component/cards/MainCard';

// Define the props interface
interface MasterPanelProps {
  title: string | ReactNode;
  children: ReactNode;
  // We can add other MainCard props later if needed (e.g., secondary)
}

/**
 * MasterPanel is a standardized wrapper for the 'master' view
 * (e.g., list of orders) in the Master/Context layout.
 * It is built on top of Berry's MainCard.
 */
const MasterPanel: React.FC<MasterPanelProps> = ({ title, children }) => {
  return (
    // We set content={false} to allow children (like a DataGrid)
    // to fill the panel's height without card padding.
    <MainCard
      title={title}
      content={false} 
      sx={{ height: '100%' }} // Ensure it fills the resizable panel
    >
      {children}
    </MainCard>
  );
};

export default MasterPanel;