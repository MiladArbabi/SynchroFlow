// apps/frontend/src/components/onboarding/OnboardingReadinessPanel.tsx
import React from 'react';
import type { ModuleOnboardingReadiness } from '@lasyncro/shared';
import { useOnboardingReadiness } from 'hooks/useOnboardingReadiness';

type OnboardingReadinessPanelProps = {
  shopId?: number;
  accessToken?: string;
};

export const OnboardingReadinessPanel: React.FC<OnboardingReadinessPanelProps> = ({
  shopId,
  accessToken,
}) => {
  const { data, loading, error, refetch } = useOnboardingReadiness({
    shopId,
    accessToken,
  });

  if (loading) {
    return <div>Loading onboarding readiness…</div>;
  }

  if (error) {
    return (
      <div>
        <div>Failed to load onboarding readiness.</div>
        <pre>{error.message}</pre>
        <button type="button" onClick={() => refetch()}>
          Retry
        </button>
      </div>
    );
  }

  if (!data) {
    return <div>No onboarding readiness data.</div>;
  }

  const { modules } = data;

  if (!modules || modules.length === 0) {
    return <div>No modules defined for onboarding.</div>;
  }

  return (
    <div>
      <h3>Onboarding readiness (shop #{data.shopId})</h3>
      {modules.map((module: ModuleOnboardingReadiness) => (
        <div key={module.moduleId} style={{ border: '1px solid #eee', marginBottom: 12, padding: 8 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <strong>{module.displayName}</strong>
            <span>{module.isReady ? '✅ Ready' : '⏳ Not ready'}</span>
          </div>

          <ul style={{ marginTop: 8 }}>
            {module.tasks.map((task) => (
              <li key={task.id}>
                {task.label} — {task.required ? '[required]' : '[optional]'} —{' '}
                {task.complete ? '✅' : '⬜'}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
};

export default OnboardingReadinessPanel;