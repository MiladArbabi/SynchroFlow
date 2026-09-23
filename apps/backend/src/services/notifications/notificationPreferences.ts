export type NotificationUrgency =
  | 'critical_only'
  | 'important_critical'
  | 'all';

export type DailySummary = 'off' | 'morning' | 'evening';

export type AlertTone = 'urgent' | 'standard' | 'silent';

type JsonObject = Record<string, unknown>;

export interface NotificationPreferences {
  schema_version: 2;
  urgency: NotificationUrgency;
  channels: {
    in_app: true;
    push: boolean;
    email: boolean;
  };
  quiet_hours: {
    enabled: boolean;
    start: string;
    end: string;
    allow_critical: boolean;
  };
  daily_summary: DailySummary;
  conditions: Record<string, JsonObject>;
  push_enabled?: boolean;
  alert_tone?: AlertTone;
  alert_types?: Record<string, boolean>;
}

export class NotificationPreferencesValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotificationPreferencesValidationError';
  }
}

const URGENCY_VALUES = new Set<NotificationUrgency>([
  'critical_only',
  'important_critical',
  'all',
]);

const DAILY_SUMMARY_VALUES = new Set<DailySummary>([
  'off',
  'morning',
  'evening',
]);

const ALERT_TONE_VALUES = new Set<AlertTone>([
  'urgent',
  'standard',
  'silent',
]);

const PATCH_TOP_LEVEL_KEYS = new Set([
  'schema_version',
  'urgency',
  'channels',
  'quiet_hours',
  'daily_summary',
  'conditions',
  'push_enabled',
  'alert_tone',
  'alert_types',
]);

const CHANNEL_KEYS = new Set(['in_app', 'push', 'email']);
const QUIET_HOURS_KEYS = new Set([
  'enabled',
  'start',
  'end',
  'allow_critical',
]);

const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  schema_version: 2,
  urgency: 'important_critical',
  channels: {
    in_app: true,
    push: true,
    email: false,
  },
  quiet_hours: {
    enabled: false,
    start: '22:00',
    end: '07:00',
    allow_critical: true,
  },
  daily_summary: 'off',
  conditions: {},
};

function isPlainObject(value: unknown): value is JsonObject {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value)
  );
}

function assertBoolean(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') {
    throw new NotificationPreferencesValidationError(`${path} must be boolean`);
  }
  return value;
}

function assertTime(value: unknown, path: string): string {
  if (typeof value !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) {
    throw new NotificationPreferencesValidationError(`${path} must be HH:mm`);
  }
  return value;
}

function cloneDefaults(): NotificationPreferences {
  return {
    ...DEFAULT_NOTIFICATION_PREFERENCES,
    channels: { ...DEFAULT_NOTIFICATION_PREFERENCES.channels },
    quiet_hours: { ...DEFAULT_NOTIFICATION_PREFERENCES.quiet_hours },
    conditions: {},
  };
}

function normalizeAlertTypes(value: unknown): Record<string, boolean> | undefined {
  if (value === undefined) return undefined;
  if (!isPlainObject(value)) {
    throw new NotificationPreferencesValidationError('alert_types must be an object');
  }

  const result: Record<string, boolean> = {};
  for (const [key, enabled] of Object.entries(value)) {
    if (!/^[a-z0-9_:-]{1,80}$/.test(key)) {
      throw new NotificationPreferencesValidationError('alert_types contains an invalid key');
    }
    result[key] = assertBoolean(enabled, `alert_types.${key}`);
  }
  return result;
}

function normalizeConditions(value: unknown): Record<string, JsonObject> {
  if (value === undefined) return {};
  if (!isPlainObject(value)) {
    throw new NotificationPreferencesValidationError('conditions must be an object');
  }

  const entries = Object.entries(value);
  if (entries.length > 50) {
    throw new NotificationPreferencesValidationError('conditions contains too many entries');
  }

  const result: Record<string, JsonObject> = {};
  for (const [conditionKey, settings] of entries) {
    if (!/^[a-z0-9_:-]{1,120}$/.test(conditionKey)) {
      throw new NotificationPreferencesValidationError('conditions contains an invalid key');
    }
    if (!isPlainObject(settings)) {
      throw new NotificationPreferencesValidationError(`conditions.${conditionKey} must be an object`);
    }

    const normalizedSettings: JsonObject = {};
    for (const [settingKey, settingValue] of Object.entries(settings)) {
      switch (settingKey) {
        case 'enabled':
        case 'push':
        case 'email':
          normalizedSettings[settingKey] = assertBoolean(
            settingValue,
            `conditions.${conditionKey}.${settingKey}`,
          );
          break;
        case 'threshold_minutes':
          if (
            typeof settingValue !== 'number' ||
            !Number.isInteger(settingValue) ||
            settingValue < 0 ||
            settingValue > 10080
          ) {
            throw new NotificationPreferencesValidationError(
              `conditions.${conditionKey}.${settingKey} must be an integer between 0 and 10080`,
            );
          }
          normalizedSettings[settingKey] = settingValue;
          break;
        default:
          throw new NotificationPreferencesValidationError(
            `conditions.${conditionKey}.${settingKey} is not supported`,
          );
      }
    }
    result[conditionKey] = normalizedSettings;
  }

  return result;
}

export function normalizeNotificationPreferences(raw: unknown): NotificationPreferences {
  const source = isPlainObject(raw) ? raw : {};
  const normalized = cloneDefaults();
  const hasCanonicalPush =
    isPlainObject(source.channels) && source.channels.push !== undefined;

  if (typeof source.urgency === 'string') {
    if (!URGENCY_VALUES.has(source.urgency as NotificationUrgency)) {
      throw new NotificationPreferencesValidationError('urgency is invalid');
    }
    normalized.urgency = source.urgency as NotificationUrgency;
  }

  if (isPlainObject(source.channels)) {
    if (source.channels.push !== undefined) {
      normalized.channels.push = assertBoolean(source.channels.push, 'channels.push');
    }
    if (source.channels.email !== undefined) {
      normalized.channels.email = assertBoolean(source.channels.email, 'channels.email');
    }
  }

  if (!hasCanonicalPush && source.push_enabled !== undefined) {
    normalized.channels.push = assertBoolean(source.push_enabled, 'push_enabled');
  }

  if (isPlainObject(source.quiet_hours)) {
    if (source.quiet_hours.enabled !== undefined) {
      normalized.quiet_hours.enabled = assertBoolean(
        source.quiet_hours.enabled,
        'quiet_hours.enabled',
      );
    }
    if (source.quiet_hours.start !== undefined) {
      normalized.quiet_hours.start = assertTime(
        source.quiet_hours.start,
        'quiet_hours.start',
      );
    }
    if (source.quiet_hours.end !== undefined) {
      normalized.quiet_hours.end = assertTime(
        source.quiet_hours.end,
        'quiet_hours.end',
      );
    }
    if (source.quiet_hours.allow_critical !== undefined) {
      normalized.quiet_hours.allow_critical = assertBoolean(
        source.quiet_hours.allow_critical,
        'quiet_hours.allow_critical',
      );
    }
  }

  if (typeof source.daily_summary === 'string') {
    if (!DAILY_SUMMARY_VALUES.has(source.daily_summary as DailySummary)) {
      throw new NotificationPreferencesValidationError('daily_summary is invalid');
    }
    normalized.daily_summary = source.daily_summary as DailySummary;
  }

  normalized.conditions = normalizeConditions(source.conditions);

  if (source.alert_tone !== undefined) {
    if (
      typeof source.alert_tone !== 'string' ||
      !ALERT_TONE_VALUES.has(source.alert_tone as AlertTone)
    ) {
      throw new NotificationPreferencesValidationError(
        'alert_tone must be one of: urgent, standard, silent',
      );
    }
    normalized.alert_tone = source.alert_tone as AlertTone;
  }

  const alertTypes = normalizeAlertTypes(source.alert_types);
  if (alertTypes) normalized.alert_types = alertTypes;

  normalized.push_enabled = normalized.channels.push;

  return normalized;
}

function assertOnlyKeys(
  value: JsonObject,
  allowed: Set<string>,
  path: string,
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      throw new NotificationPreferencesValidationError(`${path}.${key} is not supported`);
    }
  }
}

export function mergeNotificationPreferences(
  existing: unknown,
  patch: unknown,
): NotificationPreferences {
  if (!isPlainObject(patch)) {
    throw new NotificationPreferencesValidationError('preferences patch must be an object');
  }
  assertOnlyKeys(patch, PATCH_TOP_LEVEL_KEYS, 'preferences');
  if (patch.schema_version !== undefined && patch.schema_version !== 2) {
    throw new NotificationPreferencesValidationError('schema_version must be 2');
  }
  if (patch.channels !== undefined && !isPlainObject(patch.channels)) {
    throw new NotificationPreferencesValidationError('channels must be an object');
  }
  if (isPlainObject(patch.channels)) {
    assertOnlyKeys(patch.channels, CHANNEL_KEYS, 'channels');
  }
  if (patch.quiet_hours !== undefined && !isPlainObject(patch.quiet_hours)) {
    throw new NotificationPreferencesValidationError('quiet_hours must be an object');
  }
  if (isPlainObject(patch.quiet_hours)) {
    assertOnlyKeys(patch.quiet_hours, QUIET_HOURS_KEYS, 'quiet_hours');
  }
  if (patch.conditions !== undefined && !isPlainObject(patch.conditions)) {
    throw new NotificationPreferencesValidationError('conditions must be an object');
  }
  if (patch.alert_types !== undefined && !isPlainObject(patch.alert_types)) {
    throw new NotificationPreferencesValidationError('alert_types must be an object');
  }

  const current = normalizeNotificationPreferences(existing);
  const merged: JsonObject = {
    ...current,
    ...patch,
    channels: {
      ...current.channels,
      ...(isPlainObject(patch.channels) ? patch.channels : {}),
      in_app: true,
    },
    quiet_hours: {
      ...current.quiet_hours,
      ...(isPlainObject(patch.quiet_hours) ? patch.quiet_hours : {}),
    },
    conditions: {
      ...current.conditions,
      ...(isPlainObject(patch.conditions) ? patch.conditions : {}),
    },
    alert_types: {
      ...(current.alert_types ?? {}),
      ...(isPlainObject(patch.alert_types) ? patch.alert_types : {}),
    },
  };

  if (patch.alert_types === undefined && current.alert_types === undefined) {
    delete merged.alert_types;
  }

  if (patch.push_enabled !== undefined) {
    merged.push_enabled = patch.push_enabled;
    if (!isPlainObject(patch.channels) || patch.channels.push === undefined) {
      (merged.channels as JsonObject).push = patch.push_enabled;
    }
  }

  const normalized = normalizeNotificationPreferences(merged);
  normalized.push_enabled = normalized.channels.push;

  return normalized;
}
