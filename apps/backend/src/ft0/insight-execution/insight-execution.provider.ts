import db from 'api-db';
import { OnboardingSignalProvider } from 'apps/backend/src/onboarding/readiness.providers';

export const ft0InsightExecutionSignalProvider: OnboardingSignalProvider = {
  moduleId: 'insight-core',

  async getSignals({ shopId }) {
    const row = await db('ft0_insight_executions')
      .where({ shop_id: shopId })
      .orderBy('attempted_at', 'desc')
      .first();

    if (!row) {
      return [
        { name: 'insight.execution.attempted', value: false },
        { name: 'insight.execution.status', value: null }
      ];
    }

    return [
      { name: 'insight.execution.attempted', value: true },
      { name: 'insight.execution.status', value: row.status }
    ];
  }
};
