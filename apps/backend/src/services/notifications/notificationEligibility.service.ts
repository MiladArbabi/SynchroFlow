import {
  getNotificationCondition,
  type NotificationConditionDefinition,
  type NotificationConditionUrgency,
} from './notificationConditionRegistry.js';
import {
  normalizeNotificationPreferences,
  type NotificationPreferences,
  type NotificationUrgency,
} from './notificationPreferences.js';

export type NotificationEligibilityResult =
  | {
      eligible: true;
      condition: NotificationConditionDefinition;
      preferences: NotificationPreferences;
      reason: 'eligible';
    }
  | {
      eligible: false;
      condition?: NotificationConditionDefinition;
      preferences?: NotificationPreferences;
      reason:
        | 'unknown_condition'
        | 'condition_disabled'
        | 'urgency_filtered';
    };

const URGENCY_ALLOWED: Record<NotificationUrgency, NotificationConditionUrgency[]> = {
  critical_only: ['critical'],
  important_critical: ['critical', 'important'],
  all: ['critical', 'important', 'informational'],
};

export function urgencyAllowsNotification(
  preferenceUrgency: NotificationUrgency,
  conditionUrgency: NotificationConditionUrgency,
): boolean {
  return URGENCY_ALLOWED[preferenceUrgency].includes(conditionUrgency);
}

function conditionEnabled(
  condition: NotificationConditionDefinition,
  preferences: NotificationPreferences,
): boolean {
  const setting = preferences.conditions[condition.key];
  if (!setting || typeof setting.enabled !== 'boolean') {
    return condition.defaultEnabled;
  }
  return setting.enabled;
}

export function evaluateNotificationEligibility(params: {
  conditionKey: string;
  preferences?: unknown;
}): NotificationEligibilityResult {
  const condition = getNotificationCondition(params.conditionKey);
  if (!condition) return { eligible: false, reason: 'unknown_condition' };

  const preferences = normalizeNotificationPreferences(params.preferences);
  const enabled = conditionEnabled(condition, preferences);

  if (!enabled && !condition.criticalInAppProtection) {
    return {
      eligible: false,
      condition,
      preferences,
      reason: 'condition_disabled',
    };
  }

  if (!urgencyAllowsNotification(preferences.urgency, condition.urgency)) {
    return {
      eligible: false,
      condition,
      preferences,
      reason: 'urgency_filtered',
    };
  }

  return {
    eligible: true,
    condition,
    preferences,
    reason: 'eligible',
  };
}
