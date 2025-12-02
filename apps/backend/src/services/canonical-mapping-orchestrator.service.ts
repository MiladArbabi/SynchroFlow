//apps/backend/src/services/canonical-mapping-orchestrator.service.ts
import { CanonicalOrder } from '@synchroflow/shared/contracts/canonical-commerce';
import { get } from 'lodash';

export interface MappingRule {
  source: string;   // JSON path into staged_event.raw_payload
  target: string;   // JSON path into canonical order
  required?: boolean;
  literal?: any;
}

export class CanonicalMappingOrchestrator {
  constructor() {}

  /**
   * Main entry: apply mapping rules to staged_event.raw_payload
   */
  async applyMappings(
    rawPayload: Record<string, any>,
    rules: MappingRule[],
  ): Promise<CanonicalOrder> {
    if (!rawPayload || typeof rawPayload !== 'object') {
      throw new Error('Invalid raw payload');
    }

    const output: any = {};

    for (const rule of rules) {
      const { source, target, required, literal } = rule;

      let value;

      if (literal !== undefined) {
        value = literal;
      } else {
        value = get(rawPayload, source);
      }

      if (required && (value === undefined || value === null)) {
        throw new Error(`Required field missing: ${target}`);
      }

      this.assignDeep(output, target, value);
    }

    // Minimal top-level validation (tests expect this)
    if (!output.id) throw new Error('Missing canonical id');
    if (!output.shopId) throw new Error('Missing canonical shopId');

    return output as CanonicalOrder;
  }

  /**
   * Assigns deeply to an object path, e.g.:
   *   assignDeep(obj, "customer.address.city", "NYC")
   */
  private assignDeep(obj: any, path: string, value: any) {
    const parts = path.split('.');
    let current = obj;

    for (let i = 0; i < parts.length; i++) {
      const key = parts[i];

      const isLast = i === parts.length - 1;
      if (isLast) {
        current[key] = value;
      } else {
        if (current[key] === undefined) current[key] = {};
        current = current[key];
      }
    }
  }
}
