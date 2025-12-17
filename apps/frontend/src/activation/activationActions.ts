//apps/frontend/src/activation/activationActions.ts
export type ActivationAction = () => void;

const actions: Record<string, ActivationAction> = {};

export function registerActivationAction(
  moduleId: string,
  action: ActivationAction
) {
  actions[moduleId] = action;
}

export function getActivationAction(moduleId: string): ActivationAction {
  const action = actions[moduleId];
  if (!action) {
    throw new Error(`No activation action registered for ${moduleId}`);
  }
  return action;
}