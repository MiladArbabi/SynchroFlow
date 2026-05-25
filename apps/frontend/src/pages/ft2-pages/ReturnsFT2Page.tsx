import { Routes, Route } from 'react-router-dom';
import { ModuleTabBar } from '../../components/ModuleTabBar';
import { ORDERS_MODULE_TABS } from './ordersModuleTabs';
import { RETURNS_SUB_TABS } from './returnsSubTabs';
import ReturnsOverviewPage from './ReturnsOverviewPage';
import ReturnsItemsPage from './ReturnsItemsPage';
import ReturnsSuppliersPage from './ReturnsSuppliersPage';
import { Box } from '@mui/material';

export default function ReturnsFT2Page() {
  return (
    <>
      <ModuleTabBar tabs={ORDERS_MODULE_TABS} />
      <Box sx={{
        bgcolor: 'var(--bg)',
        borderBottom: '0.5px solid var(--rule)',
        borderLeft: '3px solid var(--accent)',
      }}>
        <ModuleTabBar tabs={RETURNS_SUB_TABS} />
      </Box>
      <Routes>
        <Route path="/"          element={<ReturnsOverviewPage />} />
        <Route path="/items"     element={<ReturnsItemsPage />} />
        <Route path="/suppliers" element={<ReturnsSuppliersPage />} />
      </Routes>
    </>
  );
}