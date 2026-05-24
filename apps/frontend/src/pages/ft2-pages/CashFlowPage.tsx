// apps/frontend/src/pages/ft2-pages/CashFlowPage.tsx
import { CashFlowModuleFT2 } from '@lasyncro/cashflow';
import { useCashFlow } from '../finances/useCashFlow';
import { useEntitlements } from '../../contexts/EntitlementsContext';
import { useExchangeRates } from '../../hooks/useExchangeRates';
import { PlanGate } from '../../components/PlanGate';
import { useCashFlowSettings, useUpdateCashFlowSettings } from '../cashflow/useCashFlowSettings';
import { ModuleTabBar } from '../../components/ModuleTabBar';

export default function CashFlowPage() {
  const { data, isLoading, isError } = useCashFlow();
  const { displayCurrency, locale } = useEntitlements();
  const { rates } = useExchangeRates();
  const { data: settings } = useCashFlowSettings();
  const { mutateAsync: saveSettings } = useUpdateCashFlowSettings();

  return (
    // TIER GATE: cashflow.revenue_buckets requires 'core' (see usePlanEntitlement PLAN_FEATURES)
    <PlanGate feature="cashflow.revenue_buckets">
      <ModuleTabBar tabs={[
        { id: 'finances',   label: 'Finances',       path: '/finances'        },
        { id: 'cashflow',   label: 'Cash Flow',     path: '/cashflow'        },
        { id: 'margin',     label: 'Margin',         path: '/finances/margin' },
      ]} />
      <CashFlowModuleFT2
        data={data ?? null}
        isLoading={isLoading}
        isError={isError}
        currency={{ displayCurrency, locale, rates }}
        settings={settings ?? null}
        onSaveSettings={saveSettings}
      />
    </PlanGate>
  );
}