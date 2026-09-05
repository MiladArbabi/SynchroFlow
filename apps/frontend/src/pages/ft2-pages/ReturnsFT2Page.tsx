import { Routes, Route } from 'react-router-dom';
import { ModuleTabBar } from '../../components/ModuleTabBar';
import { RETURNS_SUB_TABS } from './returnsSubTabs';
import ReturnsOverviewPage from './ReturnsOverviewPage';
import ReturnsItemsPage from './ReturnsItemsPage';
import ReturnsSuppliersPage from './ReturnsSuppliersPage';
import { Box } from '@mui/material';
import { CommercialGate } from '../../components/CommercialGate';


export default function ReturnsFT2Page() {
  // COMMERCIAL-ACCESS-ARCH-01 P0-A3-3: the Returns MANAGEMENT subtree
  // (/returns, /returns/items, /returns/suppliers) is owned by returns.core.
  // Gating the SUBTREE — not just the nav entries — is what makes a direct URL
  // resolve the same AccessDecision as the nav click; nav presentation is not a
  // security boundary. Growth/Scale inherit returns.core, so the Suppliers page
  // keeps its own narrower returns.analysis decision inside this gate.
  //
  // returns.intake (Starter+) is deliberately NOT gated here: physical return
  // receiving is warehouse execution and stays reachable through the WMS flow.
  return (
    <CommercialGate capabilityId="returns.core" featureName="Returns">
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
      </Routes>
    </CommercialGate>
  );
}