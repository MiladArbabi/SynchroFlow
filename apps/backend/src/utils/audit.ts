// apps/backend/src/utils/audit.ts

type AuditLevel = 'INFO' | 'WARN' | 'SECURITY';

interface AuditEvent {
  level: AuditLevel;
  event: string;
  userId?: number;
  shopId?: number;
  metadata?: Record<string, unknown>;
}

export const audit = (entry: AuditEvent) => {
  const payload = {
    timestamp: new Date().toISOString(),
    ...entry,
  };

  // Centralized structured logging
  // Later: pipe to Datadog / Loki / SIEM
  console.log('[AUDIT]', JSON.stringify(payload));
};
