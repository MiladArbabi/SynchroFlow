// modules/shared/src/contracts/onboarding.ts
// Cross-module onboarding contract for LaSyncro (v1)
//
// This mirrors docs/onboarding/OnboardingContract.md and is the SINGLE source of truth
// for onboarding types used by backend + frontend.

// --- Module & signal primitives ---

export type ModuleId =
  | 'platform'          // Store connection, FT0 integration-level tasks
  | 'order-nexus'
  | 'return-nexus'
  | 'insight-core'
  | 'analytics'
  | 'specter'
  | 'sku-os'
  | 'wms-lite'
  | 'problem-center';

export type ReadinessSignalName = string; // e.g. "integration.connected"

// Generic representation of a readiness signal value.
export type ReadinessSignalValue = boolean | number | string | null;

export interface ReadinessSignal {
  name: ReadinessSignalName;
  value: ReadinessSignalValue;
}

// --- Task completion rules ---

export type OnboardingTaskCompletionOperator =
  | 'presence'   // signal exists, regardless of value
  | 'equals'
  | 'not_equals'
  | 'gte'
  | 'lte'
  | 'gt'
  | 'lt';

export interface OnboardingTaskCompletionRule {
  /**
   * The readiness signal this rule depends on.
   * Examples:
   *  - "integration.connected"
   *  - "integration.syncCompleted"
   *  - "orderNexus.ordersIngested"
   *  - "returnNexus.hasReturnCase"
   */
  signal: ReadinessSignalName;

  /**
   * Operator for evaluating completion.
   * Defaults:
   *  - if expectedValue is undefined → "presence"
   *  - otherwise → "equals"
   */
  operator?: OnboardingTaskCompletionOperator;

  /**
   * Expected value for the rule, where applicable.
   * Examples:
   *  - true / false
   *  - numeric thresholds (e.g. >= 5 orders)
   *  - specific mode string ("growth", "architect", etc.)
   */
  expectedValue?: ReadinessSignalValue;
}

// --- Task actions (what happens on click) ---

export type OnboardingActionType =
  | 'navigate'   // internal route
  | 'openModal'  // open a named modal in the app
  | 'openExternal' // external URL
  | 'none';

export interface OnboardingAction {
  type: OnboardingActionType;

  /**
   * Target meaning depends on type:
   *  - navigate: route path (e.g. "/settings/cost-model")
   *  - openModal: modal id (e.g. "connect-store")
   *  - openExternal: absolute URL
   */
  target?: string;

  /**
   * Optional, loosely-typed params for the target.
   * Frontend is responsible for interpreting these.
   */
  params?: Record<string, unknown>;
}

// --- Core task + module readiness ---

export interface ModuleOnboardingTask {
  /**
   * Unique per module.
   * Example:
   *  - "connect-shopify"
   *  - "process-first-orders"
   *  - "confirm-business-mode"
   */
  id: string;

  /**
   * Human-facing label.
   * Example: "Connect your Shopify store"
   */
  label: string;

  /**
   * Optional description for tooltips or expanded views.
   */
  description?: string;

  /**
   * Whether this task is required for the module to be considered "ready".
   */
  required: boolean;

  /**
   * Completion rules defined in terms of readiness signals.
   * A task is considered complete when ALL rules are satisfied.
   */
  completionRules: OnboardingTaskCompletionRule[];

  /**
   * Optional UI action invoked when the task is clicked.
   * The frontend may still choose to ignore this and route manually.
   */
  action?: OnboardingAction;

  /**
   * Derived field: backend sets this when returning readiness snapshots.
   * Frontend can use it directly instead of re-evaluating rules.
   */
  complete?: boolean;
}

export interface ModuleOnboardingReadiness {
  moduleId: ModuleId;
  displayName: string;

  /**
   * All tasks defined for this module.
   * NOTE: Some may be optional (`required: false`) but still shown in UI.
   */
  tasks: ModuleOnboardingTask[];

  /**
   * Derived readiness flag for this module.
   * Typically:
   *  - true → all required tasks are complete
   *  - false → at least one required task is incomplete
   */
  isReady: boolean;

  /**
   * Signals this module depends on to determine readiness.
   * This helps the backend compute only what is needed and lets the frontend
   * reason about missing data.
   */
  requiredSignals: ReadinessSignalName[];

  /**
   * Concrete values of readiness signals used when deriving isReady and
   * evaluating task completion rules.
   *
   * The backend readiness providers must populate this from real system state;
   * the frontend should treat it as read-only.
   */
  signals: ReadinessSignal[];
}

// --- FT1 (Onboarding completion) verdict ---

export interface FT1Verdict {
  /**
   * True when the user has completed onboarding
   * across all required modules.
   */
  isComplete: boolean;

  /**
   * Modules that are blocking FT1 completion.
   * Empty when isComplete === true.
   */
  blockingModules: ModuleId[];

  /**
   * Modules that are already ready.
   * Useful for UI progress and diagnostics.
   */
  readyModules: ModuleId[];
}

// --- Top-level snapshot ---

export interface OnboardingReadinessSnapshot {
  shopId: number;
  modules: ModuleOnboardingReadiness[];

  /**
   * Derived, authoritative onboarding verdict.
   * Frontend MUST use this to determine FT1.
   */
  ft1: FT1Verdict;
}
