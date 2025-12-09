// apps/backend/src/onboarding/readiness.service.ts
import {
  OnboardingReadinessSnapshot,
  ModuleOnboardingReadiness,
  ModuleOnboardingTask,
  ReadinessSignal,
  OnboardingTaskCompletionRule,
} from '@lasyncro/shared';
import { onboardingSignalProviders } from './readiness.providers';
import { MODULE_ONBOARDING_MANIFESTS } from './readiness.manifest';

export class OnboardingReadinessService {
  async getSnapshot(ctx: { shopId: number; userId?: number }): Promise<OnboardingReadinessSnapshot> {
    const { shopId, userId } = ctx;

    // 1. Gather all signals from all providers
    const signalSets = await Promise.all(
      onboardingSignalProviders.map((p) => p.getSignals({ shopId, userId }))
    );
    const allSignals: ReadinessSignal[] = signalSets.flat();

    // 2. Build readiness per module
    const modules: ModuleOnboardingReadiness[] = MODULE_ONBOARDING_MANIFESTS.map((manifest) => {
      const moduleSignals = allSignals.filter((s) =>
        manifest.requiredSignals.includes(s.name)
      );

      const tasks = manifest.tasks.map((task) => ({
        ...task,
        complete: this.isTaskComplete(task, moduleSignals),
      }));

      const isReady = tasks
        .filter((t) => t.required)
        .every((t) => this.isTaskComplete(t, moduleSignals));

      return {
        ...manifest,
        tasks,
        isReady,
        signals: moduleSignals,
      };
    });

    return {
      shopId,
      modules,
    };
  }

  private isTaskComplete(task: ModuleOnboardingTask, signals: ReadinessSignal[]): boolean {
    // If no completionRules are defined, treat as incomplete by default.
    if (!task.completionRules || task.completionRules.length === 0) return false;

    // Default semantics: multiple completionRules are treated as OR.
    // i.e., the task is complete if ANY of the provided completion rules is satisfied.
    // This allows manifest authors to express "either A or B" completion without
    // adding combined-rule syntax. Tasks that must require multiple conditions
    // should provide a single composite rule object (or change manifest).
    return task.completionRules.some(rule => this.evaluateRule(rule, signals));
  }

  private evaluateRule(rule: OnboardingTaskCompletionRule, signals: ReadinessSignal[]): boolean {
    const signal = signals.find(s => s.name === rule.signal);

    if (!signal) return false;

    const operator = rule.operator || (rule.expectedValue === undefined ? 'presence' : 'equals');

    switch (operator) {
      case 'presence':
        return true;

      case 'equals':
        return signal.value === rule.expectedValue;

      case 'not_equals':
        return signal.value !== rule.expectedValue;

      case 'gte':
        return Number(signal.value) >= Number(rule.expectedValue);

      case 'lte':
        return Number(signal.value) <= Number(rule.expectedValue);

      case 'gt':
        return Number(signal.value) > Number(rule.expectedValue);

      case 'lt':
        return Number(signal.value) < Number(rule.expectedValue);

      default:
        return false;
    }
  }
}
