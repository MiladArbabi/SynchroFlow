import { Routes, Route } from 'react-router-dom';
import { ModuleTabBar } from '../../components/ModuleTabBar';
import { RETURNS_RESOLUTION_MODULE_TABS } from './returnsResolutionModuleTabs';
import { RETURNS_SUB_TABS } from './returnsSubTabs';
import ReturnsOverviewPage from './ReturnsOverviewPage';
import ReturnsItemsPage from './ReturnsItemsPage';
import ReturnsSuppliersPage from './ReturnsSuppliersPage';
import { Box } from '@mui/material';
import ReturnJobBriefPage from './ReturnJobBriefPage';
export default function ReturnsFT2Page() {
  return (
    <>
    <ModuleTabBar tabs={RETURNS_RESOLUTION_MODULE_TABS} />
      <Box sx={{
        bgcolor: 'var(--bg)',
        borderBottom: '1px solid var(--rule)',
      }}>
        <ModuleTabBar tabs={RETURNS_SUB_TABS} />
      </Box>
      <Routes>
        <Route path="/"          element={<ReturnsOverviewPage />} />
        <Route path="/items"     element={<ReturnsItemsPage />} />
        <Route path="/suppliers" element={<ReturnsSuppliersPage />} />
        <Route path="/jobs/:id"  element={<ReturnJobBriefPage />} />
      </Routes>
    </>
  );
}