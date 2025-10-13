// packages/ui/src/pages/DashboardPage.tsx
import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { CashFlowChart } from '../components/CashFlowChart';
import { SimulationModal } from '../components/SimulationModal';
import { useUser } from '../contexts/UserContext';
import { ConnectStoreModal } from '../components/ConnectStoreModal';

// A simple placeholder for a KPI widget
const KpiCard = ({ title, value, isLoading }: { title: string, value: string, isLoading: boolean }) => (
  <div style={{ backgroundColor: 'white', padding: '1.5rem', border: '1px solid #E5E7EB', borderRadius: '0.5rem' }}>
    <h3 style={{ color: '#434D5B', fontSize: '0.875rem', fontWeight: '500' }}>{title}</h3>
    <p style={{ color: '#1F2937', fontSize: '1.875rem', fontWeight: 'bold', marginTop: '0.5rem' }}>
      {isLoading ? 'Loading...' : value}
    </p>
  </div>
);

const SandboxBanner: React.FC<{ onClick: () => void }> = ({ onClick }) => (
  <div className="rounded-md bg-blue-50 p-4 mb-8">
    <div className="flex">
      <div className="ml-3 flex-1 md:flex md:justify-between">
        <p className="text-sm text-blue-700">
          You are currently in a sandbox environment. Explore with sample data, or connect your own store to see real insights.
        </p>
        <p className="mt-3 text-sm md:ml-6 md:mt-0">
        <button onClick={onClick} className="whitespace-nowrap font-medium text-blue-700 hover:text-blue-600">            Connect Your Store &rarr;
          </button>
        </p>
      </div>
    </div>
  </div>
);

export function DashboardPage() {

  const [inventoryValue, setInventoryValue] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const { isSandbox } = useUser();

  // State for the modals
  const [isSimulationModalOpen, setIsSimulationModalOpen] = useState(false);
  const [isConnectModalOpen, setIsConnectModalOpen] = useState(false);

  // State for our cash flow data
  const initialCashFlow = [
    { name: 'Week 1', cash: 10000 },
    { name: 'Week 2', cash: -5000 },
    { name: 'Week 3', cash: 12000 },
    { name: 'Week 4', cash: 8000 },
  ];
  const [cashFlowData, setCashFlowData] = useState(initialCashFlow);

  useEffect(() => {
    const fetchInventoryValue = async () => {
      try {
        // The '/api' prefix will be handled by the Vite proxy
        const response = await axios.get('/api/v1/analytics/inventory-value');
        setInventoryValue(response.data.total_inventory_value);
      } catch {
        setError('Failed to fetch inventory value.');
      } finally {
        setIsLoading(false);
      }
    };

    fetchInventoryValue();
  }, []); // Empty array ensures this runs only once on mount

  const formattedValue = inventoryValue !== null
    ? `$${inventoryValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : '--';

    const handleSimulation = async () => {
    const requestBody = {
      current_cash_flow: initialCashFlow.map(d => d.cash),
      payment_details: {
        amount: 7500,
        original_due_week: 1,
        delay_weeks: 2
      }
    };

    try {
      const response = await axios.post('/api/v1/simulations/payment-delay', requestBody);
      const simulatedData = initialCashFlow.map((item, index) => ({
        ...item,
        cash: response.data.simulated_cash_flow[index],
      }));
      setCashFlowData(simulatedData);
    } catch (err) {
      console.error("Simulation failed:", err);
    }
  };

  return (
    <div>
      {isSandbox && <SandboxBanner onClick={() => setIsConnectModalOpen(true)} />}
      <h1 style={{ fontSize: '1.875rem', fontWeight: 'bold', color: '#1F2937' }}>
        FinOps Command Center
      </h1>
      {error && <p style={{ marginTop: '1rem', color: '#F84D4D' }}>{error}</p>}
      <div style={{ marginTop: '2rem', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '1.5rem' }}>
        <KpiCard title="Total Inventory Value" value={formattedValue} isLoading={isLoading} />
        <KpiCard title="Cash Conversion Cycle" value="--" isLoading={false} />
        {/* More KPIs will be added here */}
      </div>
      <CashFlowChart data={cashFlowData} onClick={() => setIsSimulationModalOpen(true)} />
      <div style={{ marginTop: '2rem' }}>
        <button
          onClick={handleSimulation}
          style={{
            backgroundColor: '#2F54EB', color: 'white', fontWeight: '600',
            padding: '0.5rem 1rem', border: 'none', borderRadius: '0.25rem'
          }}
        >
          Simulate 2-Week Delay
        </button>
       </div>
      <SimulationModal isOpen={isSimulationModalOpen} onClose={() => setIsSimulationModalOpen(false)} />
      <ConnectStoreModal isOpen={isConnectModalOpen} onClose={() => setIsConnectModalOpen(false)} />
    </div>
  );
}